/**
 * The researcher's alphaXiv tools (alphaXiv wave, 2026-11-21): the port
 * contract, the allowlist, argument mapping and the never-throw output.
 * No network: the provider is injected, exactly as the runner injects it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAlphaxivTools } from "../src/agent/tools/alphaxiv.ts";
import {
	ALPHAXIV_ALLOWED_TOOLS,
	ALPHAXIV_MCP_URL,
	ALPHAXIV_TOOLS,
	MAX_ALPHAXIV_CHARS,
	type AlphaxivProvider,
	type AlphaxivTool,
} from "../src/core/alphaxiv.ts";

function recorder(text = "OK"): { provider: AlphaxivProvider; calls: Array<{ tool: AlphaxivTool; args: Record<string, unknown> }> } {
	const calls: Array<{ tool: AlphaxivTool; args: Record<string, unknown> }> = [];
	return {
		calls,
		provider: {
			async call(tool, args) {
				calls.push({ tool, args });
				return text;
			},
		},
	};
}

describe("the alphaXiv port", () => {
	it("names a fixed https endpoint and exactly three allowlisted tools", () => {
		assert.equal(ALPHAXIV_MCP_URL, "https://api.alphaxiv.org/mcp/v1");
		assert.deepEqual([...ALPHAXIV_ALLOWED_TOOLS].sort(), [
			"answer_pdf_queries",
			"discover_papers",
			"get_paper_content",
		]);
		// The library / follow / publish tools must never be reachable: an
		// agent in a lesson does not mutate a learner's remote account.
		for (const forbidden of ["save_papers_to_folder", "follow_researcher", "publish_paper", "create_folder"]) {
			assert.ok(!(ALPHAXIV_ALLOWED_TOOLS as readonly string[]).includes(forbidden), `${forbidden} stays out`);
		}
	});
});

describe("without a key the tools stay mounted and say so", () => {
	for (const name of ["alphaxiv_search", "alphaxiv_paper", "alphaxiv_ask"] as const) {
		it(`${name} returns setup guidance, not an error result`, async () => {
			const tools = createAlphaxivTools(() => null);
			const out = await tools[name]!.execute!("c1", { question: "q", keywords: ["k"], url: "https://arxiv.org/abs/2401.12345", paper: "2401.12345", queries: ["q"] });
			assert.match(String(out.details), /alphaXiv is not available/);
			assert.match(String(out.details), /Settings → Keys → alphaXiv/);
			assert.notEqual(out.isError, true);
		});
	}
});

describe("with a provider", () => {
	it("alphaxiv_search maps question + keywords and defaults difficulty to 5", async () => {
		const { provider, calls } = recorder("candidates");
		const tools = createAlphaxivTools(() => provider);
		const out = await tools.alphaxiv_search!.execute!("c1", {
			question: "How does speculative decoding work?",
			keywords: ["speculative decoding"],
		});
		assert.equal(out.details, "candidates");
		assert.deepEqual(calls[0], {
			tool: "discover_papers",
			args: { question: "How does speculative decoding work?", keywords: ["speculative decoding"], difficulty: 5 },
		});
	});

	it("alphaxiv_search passes an explicit difficulty through", async () => {
		const { provider, calls } = recorder();
		const tools = createAlphaxivTools(() => provider);
		await tools.alphaxiv_search!.execute!("c1", { question: "q", keywords: ["k"], difficulty: 9 });
		assert.equal(calls[0]!.args.difficulty, 9);
	});

	it("alphaxiv_paper only accepts arXiv/alphaXiv URLs", async () => {
		const { provider, calls } = recorder();
		const tools = createAlphaxivTools(() => provider);
		const out = await tools.alphaxiv_paper!.execute!("c1", { url: "https://example.com/paper.pdf" });
		assert.match(String(out.details), /is not an arXiv or alphaXiv URL/);
		assert.equal(calls.length, 0, "a rejected URL never reaches the remote server");
	});

	it("alphaxiv_paper maps url + fullText", async () => {
		const { provider, calls } = recorder("report");
		const tools = createAlphaxivTools(() => provider);
		const out = await tools.alphaxiv_paper!.execute!("c1", {
			url: "https://arxiv.org/abs/2401.12345",
			fullText: true,
		});
		assert.equal(out.details, "report");
		assert.deepEqual(calls[0], {
			tool: "get_paper_content",
			args: { url: "https://arxiv.org/abs/2401.12345", fullText: true },
		});
	});

	it("alphaxiv_ask maps the paper and every question in one call", async () => {
		const { provider, calls } = recorder("passages");
		const tools = createAlphaxivTools(() => provider);
		const queries = ["What datasets were used?", "What are the ablation results?"];
		await tools.alphaxiv_ask!.execute!("c1", { paper: "2307.12307", queries });
		assert.deepEqual(calls[0], { tool: "answer_pdf_queries", args: { paper: "2307.12307", queries } });
	});

	it("truncates a long remote answer with a visible marker", async () => {
		const { provider } = recorder("x".repeat(MAX_ALPHAXIV_CHARS + 50));
		const tools = createAlphaxivTools(() => provider);
		const out = await tools.alphaxiv_ask!.execute!("c1", { paper: "2307.12307", queries: ["q"] });
		const text = String(out.details);
		assert.ok(text.length < MAX_ALPHAXIV_CHARS + 200, "answer is cut");
		assert.match(text, /\[Truncated at 40000 characters\]/);
	});

	it("a remote failure becomes recoverable text naming the tool", async () => {
		const provider: AlphaxivProvider = {
			async call() {
				throw new Error("alphaXiv tool \"discover_papers\" is not allowed");
			},
		};
		const tools = createAlphaxivTools(() => provider);
		const out = await tools.alphaxiv_search!.execute!("c1", { question: "q", keywords: ["k"] });
		assert.match(String(out.details), /^alphaxiv_search failed: /);
		assert.notEqual(out.isError, true);
	});
});

describe("the tool → server mapping", () => {
	it("is the documented trio", () => {
		assert.deepEqual(ALPHAXIV_TOOLS, {
			search: "discover_papers",
			paper: "get_paper_content",
			ask: "answer_pdf_queries",
		});
	});
});
