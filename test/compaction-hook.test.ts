// The summary-level hook with pi's real compact(), against a fake OpenAI-style server: the request asks for the
// summary level, the compaction record notes it, and the debug log says who wrote the summary at which level.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agent = mkdtempSync(join(tmpdir(), "modelctl-hook-"));
process.env.PI_CODING_AGENT_DIR = agent;
process.env.PI_MODELCTL_DEBUG = "1";
const { normalizeConfig } = await import("../src/core/config.ts");
const { modelEntries, originOf } = await import("../src/core/discover.ts");
const { Runtime } = await import("../src/pi/runtime.ts");
const { registerSummaryLevel } = await import("../src/pi/compaction.ts");

test("modelctl writes the summary at its level, notes it in the record and the log; at the chat's level it's left to pi", async (t) => {
	t.after(() => rmSync(agent, { recursive: true, force: true }));
	// A fake server that records each request and answers with a short summary.
	const requests: Record<string, unknown>[] = [];
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (c) => (body += c));
		req.on("end", () => {
			requests.push(JSON.parse(body));
			res.writeHead(200, { "content-type": "text/event-stream" });
			const chunk = (delta: unknown, finish: string | null = null) =>
				`data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
			res.write(chunk({ role: "assistant", content: "## Goal\nthe summary" }));
			res.write(chunk({}, "stop"));
			res.end("data: [DONE]\n\n");
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
	t.after(() => server.close());

	// A llama-swap model with levels low / medium / xhigh, summary level "lowest".
	const config = normalizeConfig({ engines: [{ engine: "llama-swap", enabled: true, port: 11434, name: "llama-swap" }], summaryLevel: "lowest" });
	const row = config.engines.find((r) => r.enabled)!;
	const thinking = { kind: "levels" as const, levels: ["low", "medium", "xhigh"], canTurnOff: true, source: "server metadata" };
	const [entry] = modelEntries({ row, origin: originOf(row), models: [{ id: "levels-27b", contextWindow: 81920, input: ["text"], thinking }] }, config);
	const rt = new Runtime(config, []);
	rt.catalog.set(entry!.key, entry!);

	let handler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
	let chatLevel = "medium";
	const pi = { on: (_name: string, h: typeof handler) => void (handler = h), getThinkingLevel: () => chatLevel };
	registerSummaryLevel(pi as never, rt);

	const message = (role: string, text: string) => ({
		role,
		content: [{ type: "text", text }],
		timestamp: Date.now(),
		...(role === "assistant" ? { api: "openai-completions", provider: "llama-swap", model: "levels-27b", stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } : {}),
	});
	const event = () => ({
		preparation: {
			firstKeptEntryId: "x",
			messagesToSummarize: [message("user", "hello"), message("assistant", "hi")],
			turnPrefixMessages: [],
			isSplitTurn: false,
			tokensBefore: 1000,
			fileOps: { read: new Set(["/p/a.ts"]), written: new Set(), edited: new Set() },
			settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
		},
		branchEntries: [],
		signal: new AbortController().signal,
	});
	const ctx = {
		model: { ...entry!.def, api: "openai-completions", provider: "llama-swap", baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` },
		modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }) },
		hasUI: false,
	};

	const result = (await handler!(event(), ctx)) as { compaction: { details: { summaryLevel?: string; readFiles?: string[] } } };
	const body = requests.at(-1) as { chat_template_kwargs?: { reasoning_effort?: string }; thinking_budget_tokens?: number };
	assert.equal(body.chat_template_kwargs?.reasoning_effort, "low", "the request asks for the summary level");
	assert.equal(body.thinking_budget_tokens, 2048, "with pi's default budget for that level");
	assert.equal(result.compaction.details.summaryLevel, "low", "the record notes the level");
	assert.deepEqual(result.compaction.details.readFiles, ["/p/a.ts"], "pi's own details stay");

	// The chat already at the summary level: nothing to do, pi writes it.
	chatLevel = "low";
	assert.equal(await handler!(event(), ctx), undefined);

	const logText = readFileSync(join(agent, "pi-modelctl", "debug.log"), "utf8");
	assert.match(logText, /\[compaction\] llama-swap\/levels-27b: summary written by modelctl at low \(the chat is at medium\)/);
	assert.match(logText, /\[compaction\] llama-swap\/levels-27b: summary left to pi, at the chat's level low/);
});
