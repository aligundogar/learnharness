import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { MAX_ALPHAXIV_CHARS, ALPHAXIV_TOOLS, type AlphaxivProvider } from "../../core/alphaxiv.ts";

/**
 * The researcher's alphaXiv tools (alphaXiv wave, 2026-11-21): three
 * paper tools over the remote MCP server, deliberately few. Literature
 * discovery, one-paper reading, and questions over one paper are the
 * shapes a lesson needs; library/follow/publish tools stay unexposed
 * (core/alphaxiv.ts explains why).
 *
 * Tool contract (same as web.ts): NEVER throw into the agent loop — an
 * absent provider, a missing key, a remote error and a timeout all return
 * a clear STRING the researcher can adapt to or report.
 */

const UNAVAILABLE =
	"alphaXiv is not available: no alphaXiv API key is configured. Add one in Settings → Keys → alphaXiv. " +
	"Use web_search/web_fetch for this question, and note in your brief that paper search was unavailable.";

/** Keep the researcher's context sane — one paper report is ~27k characters. */
function truncate(text: string): string {
	if (text.length <= MAX_ALPHAXIV_CHARS) return text;
	return `${text.slice(0, MAX_ALPHAXIV_CHARS)}\n\n[Truncated at ${MAX_ALPHAXIV_CHARS} characters]`;
}

function failure(what: string, err: unknown): string {
	return `${what} failed: ${err instanceof Error ? err.message : String(err)}`;
}

const searchInput = Type.Object({
	question: Type.String({
		description: "What the learner is asking, in their own terms, in English. Short beats padded.",
	}),
	keywords: Type.Array(Type.String({ minLength: 1 }), {
		description:
			"1-4 terms exactly as written by the user or seen in earlier results (acronyms stay as written; " +
			"non-English terms are translated). Do not invent expansions.",
	}),
	difficulty: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: 10,
			description: "How much retrieval effort is warranted (default 5; 8-10 for broad surveys, higher latency).",
		}),
	),
});

const paperInput = Type.Object({
	url: Type.String({
		description: "An arXiv or alphaXiv URL, e.g. https://arxiv.org/abs/2307.12307 or https://www.alphaxiv.org/abs/2307.12307",
	}),
	fullText: Type.Optional(
		Type.Boolean({
			description: "true returns the raw extracted text instead of the structured report (use for exact quotes)",
		}),
	),
});

const askInput = Type.Object({
	paper: Type.String({
		description: "The paper: an arXiv id (2307.12307), a URL, or an exact full title",
	}),
	queries: Type.Array(Type.String({ minLength: 1 }), {
		description: "One question per entry about this paper (datasets, results, method limits…). Ask them all in one call.",
	}),
});

export function createAlphaxivTools(provider: () => AlphaxivProvider | null): Record<string, AgentTool<any>> {
	return {
		alphaxiv_search: {
			name: "alphaxiv_search",
			label: "alphaxiv_search",
			description:
				"Search alphaXiv's index of 2.5M arXiv papers and get ranked candidates (ids, titles, abstracts). " +
				"Use this instead of web_search for academic literature: it searches the papers themselves, not the web.",
			parameters: searchInput,
			execute: serverExecute("alphaxiv_search", searchInput, async ({ question, keywords, difficulty }): Promise<string> => {
				const p = provider();
				if (!p) return UNAVAILABLE;
				try {
					return truncate(
						await p.call(ALPHAXIV_TOOLS.search, { question, keywords, difficulty: difficulty ?? 5 }),
					);
				} catch (err) {
					return failure("alphaxiv_search", err);
				}
			}),
		},

		alphaxiv_paper: {
			name: "alphaxiv_paper",
			label: "alphaxiv_paper",
			description:
				"Read one arXiv/alphaXiv paper as text: a structured report of the paper by default, or its raw " +
				"extracted text with fullText=true. This replaces fetching the PDF page by page.",
			parameters: paperInput,
			execute: serverExecute("alphaxiv_paper", paperInput, async ({ url, fullText }): Promise<string> => {
				const p = provider();
				if (!p) return UNAVAILABLE;
				if (!/^https:\/\/(www\.alphaxiv\.org|arxiv\.org)\//.test(url)) {
					return `alphaxiv_paper failed: "${url}" is not an arXiv or alphaXiv URL`;
				}
				try {
					return truncate(await p.call(ALPHAXIV_TOOLS.paper, { url, ...(fullText ? { fullText: true } : {}) }));
				} catch (err) {
					return failure("alphaxiv_paper", err);
				}
			}),
		},

		alphaxiv_ask: {
			name: "alphaxiv_ask",
			label: "alphaxiv_ask",
			description:
				"Ask focused questions over ONE paper and get the matching passages back, page-numbered. " +
				"Cheaper and more precise than reading the whole paper when you need specific facts or quotes.",
			parameters: askInput,
			execute: serverExecute("alphaxiv_ask", askInput, async ({ paper, queries }): Promise<string> => {
				const p = provider();
				if (!p) return UNAVAILABLE;
				try {
					return truncate(await p.call(ALPHAXIV_TOOLS.ask, { paper, queries }));
				} catch (err) {
					return failure("alphaxiv_ask", err);
				}
			}),
		},
	};
}

/** Provider-less backstop: the tools always exist and say they are
 *  unconfigured, so the researcher never loses its tool list mid-lesson. */
export const alphaxivTools = createAlphaxivTools(() => null);
