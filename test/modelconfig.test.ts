// What pi gets for each model: thinking switches, the level map, the budget field, and the user's own values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModelDef, chatTemplateKwargs, resolveContextWindow, resolveThinking } from "../src/core/modelconfig.ts";
import { llamaSwapAdapter } from "../src/adapters/llama-swap.ts";
import { ollamaAdapter } from "../src/adapters/ollama.ts";
import { openaiAdapter } from "../src/adapters/openai.ts";
import { strataAdapter } from "../src/adapters/strata.ts";
import type { DiscoveredModel } from "../src/adapters/types.ts";

const qwen38: DiscoveredModel = {
	id: "qwen3.8-27b",
	contextWindow: 81920,
	input: ["text", "image"],
	thinking: { kind: "levels", levels: ["low", "medium", "xhigh"], canTurnOff: true, preserveThinking: true },
	maxTokensHint: 32768,
};

test("levels model: template switches, level map, and the budget field pi fills", () => {
	const d = buildModelDef(qwen38, qwen38.thinking, 81920, llamaSwapAdapter);
	assert.equal(d.reasoning, true);
	assert.equal(d.maxTokens, 32768, "the server's suggested max output");
	assert.equal(d.thinkingLevelMap!.xhigh, "xhigh");
	assert.equal(d.thinkingLevelMap!.high, null, "pi doesn't offer levels the model lacks");
	assert.equal(d.compat.thinkingFormat, "chat-template");
	assert.equal(d.compat.thinkingTokenBudgetField, "thinking_budget_tokens");
	assert.deepEqual(d.compat.chatTemplateKwargs, chatTemplateKwargs(qwen38.thinking));
	assert.equal(buildModelDef(qwen38, qwen38.thinking, 262144, strataAdapter).compat.thinkingTokenBudgetField, "reasoning_budget_tokens");
});

test("Ollama: reasoning_effort with the level word, 'medium' for on, and 'none' for off; no budget field", () => {
	const onoff: DiscoveredModel = { id: "qwen3:8b", contextWindow: 8192, input: ["text"], thinking: { kind: "onoff", canTurnOff: true, onLevel: "medium" } };
	const d = buildModelDef(onoff, onoff.thinking, 8192, ollamaAdapter);
	assert.equal(d.compat.thinkingFormat, "openai");
	assert.equal(d.compat.supportsReasoningEffort, true);
	assert.equal(d.thinkingLevelMap!.medium, "medium");
	assert.equal(d.thinkingLevelMap!.off, "none", "pi sends it for off");
	assert.equal(d.compat.thinkingTokenBudgetField, undefined);
	const noOff = { ...onoff, thinking: { ...onoff.thinking, canTurnOff: false } };
	assert.equal(buildModelDef(noOff, noOff.thinking, 8192, ollamaAdapter).thinkingLevelMap!.off, null);
});

test("no thinking: no switches and no budget; max tokens never above the context", () => {
	const plain: DiscoveredModel = { id: "m", contextWindow: 4096, input: ["text"], thinking: { kind: "none", canTurnOff: false }, maxTokensHint: 99999 };
	const d = buildModelDef(plain, plain.thinking, 4096, llamaSwapAdapter);
	assert.equal(d.reasoning, false);
	assert.equal(d.thinkingLevelMap, undefined);
	assert.equal(d.compat.thinkingTokenBudgetField, undefined);
	assert.equal(d.maxTokens, 4096);
});

test("settings beat the server: context, thinking type (also on servers with no switch of their own)", () => {
	const generic: DiscoveredModel = { id: "m", input: ["text"], thinking: { kind: "onoff", canTurnOff: true } };
	assert.equal(resolveContextWindow(generic, undefined), undefined, "unknown stays unknown: no guess");
	assert.equal(resolveContextWindow(generic, { contextWindow: 32768 }), 32768);
	assert.equal(resolveThinking(generic, undefined, openaiAdapter).kind, "none", "a server without a switch can't use what its template says");
	assert.equal(resolveThinking(generic, { thinkingType: { kind: "levels", levels: ["low", "high"] } }, openaiAdapter).kind, "levels");
});
