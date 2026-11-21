/**
 * The alphaXiv provider's server composition (alphaXiv wave, 2026-11-21):
 * a remote MCP server behind the core port (core/alphaxiv.ts).
 *
 * Lifecycle: ONE client per tool call — connect, initialize, call, close.
 * The endpoint is stateless in practice (no session id to keep), and a
 * per-call connection cannot leak a socket into the next lesson turn; the
 * measured cost is ~0.3 s, well inside the researcher's tool budget.
 *
 * Auth: the key rides in the Authorization header, resolved through
 * keyValue (env wins, auth.json fills the gaps) — the SAME store the
 * Settings → Keys row writes. No key = null = the tools say "not
 * configured" (owner decision: no hidden alternative source).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
	ALPHAXIV_ALLOWED_TOOLS,
	ALPHAXIV_CLIENT_INFO,
	ALPHAXIV_KEY_ID,
	ALPHAXIV_MCP_URL,
	type AlphaxivProvider,
	type AlphaxivTool,
} from "../core/alphaxiv.ts";
import { keyValue } from "./keys.ts";

/** Under the shared tool guard (tool-execute.ts, 30 s) so the timeout the
 *  model sees is this one's message, not a bare abort. */
const CALL_TIMEOUT_MS = 25_000;

/** Text out of an MCP result; non-text blocks are named, never dropped
 *  silently (the researcher must know something was there). */
function renderContent(result: { content?: unknown }): string {
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
			const client = new Client(ALPHAXIV_CLIENT_INFO);
			const transport = new StreamableHTTPClientTransport(new URL(ALPHAXIV_MCP_URL), {
				requestInit: { headers: { Authorization: `Bearer ${key}` } },
			});
			try {
				await client.connect(transport);
				const result = await client.callTool({ name: tool, arguments: args }, undefined, {
					timeout: CALL_TIMEOUT_MS,
				});
				const text = renderContent(result as { content?: unknown });
				if ((result as { isError?: boolean }).isError) {
					throw new Error(text.trim() || "the alphaXiv server reported an error");
				}
				return text;
			} finally {
				await client.close().catch(() => undefined);
			}
		},
	};
}
