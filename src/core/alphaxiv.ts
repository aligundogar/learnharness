/**
 * The alphaXiv research port (alphaXiv wave, 2026-11-21): the contract the
 * researcher's paper tools depend on, and the single place the remote
 * endpoint + the allowlisted tools are named.
 *
 * alphaXiv publishes its index as a remote MCP server (streamable HTTP,
 * Bearer key). Only THREE of its 25+ tools are exposed to a lesson agent —
 * discovery, one-paper reading, and questions over one paper. Everything
 * that writes to the learner's alphaXiv account (library folders, follows,
 * publishing) stays out: an agent in a lesson must not mutate a remote
 * account.
 *
 * The provider is resolved in the server layer (server/alphaxiv.ts) and
 * arrives as a DEPENDENCY: the agent layer may not read the key store
 * (import law), so an absent seam reads as "not configured" and the tools
 * say so instead of crashing.
 */

/** The documented endpoint. Fixed on purpose: the key never travels to a
 *  host that the settings (or a prompt injection) can choose. */
export const ALPHAXIV_MCP_URL = "https://api.alphaxiv.org/mcp/v1";

/** Env-var / auth-store id of the API key (curated in core/auth-keys.ts). */
export const ALPHAXIV_KEY_ID = "ALPHAXIV_API_KEY";

/** MCP client identity sent at initialize. */
export const ALPHAXIV_CLIENT_INFO = { name: "learnharness", version: "1" } as const;

/** The learner-facing tool → alphaXiv tool mapping (allowlist). */
export const ALPHAXIV_TOOLS = {
	search: "discover_papers",
	paper: "get_paper_content",
	ask: "answer_pdf_queries",
} as const;

export type AlphaxivTool = (typeof ALPHAXIV_TOOLS)[keyof typeof ALPHAXIV_TOOLS];

export const ALPHAXIV_ALLOWED_TOOLS: readonly AlphaxivTool[] = Object.values(ALPHAXIV_TOOLS);

/** One paper's report is ~27k characters — the same ceiling the page
 *  fetcher uses keeps the researcher's context sane. */
export const MAX_ALPHAXIV_CHARS = 40_000;

/** One remote call: throw on transport/auth/remote failure, return the
 *  text on success. The tool layer owns the never-throw contract. */
export interface AlphaxivProvider {
	call(tool: AlphaxivTool, args: Record<string, unknown>): Promise<string>;
}
