/**
 * The alphaXiv provider's server composition (alphaXiv wave, 2026-11-21):
 * a remote MCP server behind the core port (core/alphaxiv.ts).
 *
 * Transport: plain JSON-RPC over streamable HTTP — one POST per message,
 * the reply arrives as an SSE body (or plain JSON) and the connection
 * closes. The MCP SDK's client transport stays out of this path on purpose:
 * for a stateless server that answers every POST and closes, the SDK's
 * session bookkeeping bought a second request per call and one more failure
 * mode (observed: initialize 200, the follow-up POST timing out on a host
 * with a broken IPv6 route). The wire format used here is the documented
 * subset: initialize → notifications/initialized → tools/call.
 *
 * Lifecycle: connect, call, done — per tool call. Nothing is cached and no
 * socket outlives the turn, so a lesson never inherits a dead session.
 *
 * Auth: the key rides in the Authorization header, resolved through
 * keyValue (env wins, auth.json fills the gaps) — the SAME store the
 * Settings → Keys row writes. No key = null = the tools say "not
 * configured" (no hidden alternative source).
 */

import {
	ALPHAXIV_ALLOWED_TOOLS,
	ALPHAXIV_CLIENT_INFO,
	ALPHAXIV_KEY_ID,
	ALPHAXIV_MCP_URL,
	type AlphaxivProvider,
	type AlphaxivTool,
} from "../core/alphaxiv.ts";
import { keyValue } from "./keys.ts";

/** Per-request ceiling; the shared tool guard (30 s) still caps the call. */
const REQUEST_TIMEOUT_MS = 20_000;
const PROTOCOL_VERSION = "2025-06-18";

interface RpcReply {
	json: unknown;
	sessionId: string | null;
}

function payloadOf(json: unknown): { result?: unknown; error?: { message?: string } } {
	return (json ?? {}) as { result?: unknown; error?: { message?: string } };
}

/** One JSON-RPC POST. The body is SSE (`data: {…}` lines) or plain JSON. */
async function post(body: unknown, sessionId: string | null, key: string): Promise<RpcReply> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${key}`,
		"content-type": "application/json",
		accept: "application/json, text/event-stream",
	};
	if (sessionId) headers["mcp-session-id"] = sessionId;
	const res = await fetch(ALPHAXIV_MCP_URL, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	const text = await res.text();
	const sid = res.headers.get("mcp-session-id") ?? sessionId;
	const type = res.headers.get("content-type") ?? "";
	const data = text
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trim())
		.filter(Boolean);
	const raw = data.length > 0 ? data[data.length - 1]! : text;
	if (!res.ok) throw new Error(`alphaXiv returned HTTP ${res.status}${type ? "" : ""}`);
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		throw new Error("alphaXiv returned a reply that is not JSON");
	}
	return { json, sessionId: sid };
}

/** One retry on a transport-level failure: the hosts this app runs on can
 *  lose the first connection to a cold DNS cache. A JSON-RPC error reply is
 *  NOT retried — the server already answered. */
async function postWithRetry(body: unknown, sessionId: string | null, key: string): Promise<RpcReply> {
	try {
		return await post(body, sessionId, key);
	} catch (err) {
		if (!/fetch failed|network|ECONN|socket/i.test(err instanceof Error ? err.message : String(err))) throw err;
		return post(body, sessionId, key);
	}
}

function textOf(result: { content?: unknown }): string {
	const blocks = Array.isArray(result.content) ? result.content : [];
	const parts: string[] = [];
	for (const block of blocks) {
		const b = block as { type?: string; text?: string; mimeType?: string; uri?: string };
		if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
		else if (b.type === "image") parts.push(`[image ${b.mimeType ?? ""} omitted]`);
		else if (b.type === "resource") parts.push(`[resource ${b.uri ?? ""}]`);
		else parts.push(`[${b.type ?? "unknown"} content omitted]`);
	}
	return parts.join("\n\n");
}

export function alphaxivProvider(): AlphaxivProvider | null {
	const key = keyValue(ALPHAXIV_KEY_ID)?.trim();
	if (!key) return null;
	return {
		async call(tool: AlphaxivTool, args: Record<string, unknown>): Promise<string> {
			if (!ALPHAXIV_ALLOWED_TOOLS.includes(tool)) {
				throw new Error(`alphaXiv tool "${tool}" is not allowed`);
			}
			const init = await postWithRetry(
				{
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						protocolVersion: PROTOCOL_VERSION,
						capabilities: {},
						clientInfo: ALPHAXIV_CLIENT_INFO,
					},
				},
				null,
				key,
			);
			const initError = payloadOf(init.json).error;
			if (initError) throw new Error(initError.message ?? "alphaXiv refused the connection");
			// Fire-and-forget handshake note; a server that ignores it answers
			// the next POST anyway, so its failure never fails the call.
			await postWithRetry({ jsonrpc: "2.0", method: "notifications/initialized" }, init.sessionId, key).catch(
				() => undefined,
			);
			const reply = await postWithRetry(
				{ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } },
				init.sessionId,
				key,
			);
			const { result, error } = payloadOf(reply.json);
			if (error) throw new Error(error.message ?? "the alphaXiv server reported an error");
			const r = (result ?? {}) as { content?: unknown; isError?: boolean };
			const text = textOf(r);
			if (r.isError) throw new Error(text.trim() || "the alphaXiv server reported an error");
			return text;
		},
	};
}
