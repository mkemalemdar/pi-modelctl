// vLLM: /v1/models carries the context it runs with (`max_model_len`). Thinking is switched through the chat
// template, and `thinking_token_budget` caps it (it needs the server's --reasoning-parser). Whether a model thinks
// is only known when the server shares its template: `vllm serve --enable-tokenizer-info-endpoint` adds
// /tokenizer_info. Otherwise set Thinking type on the model's page.
// Coded according to vLLM's source and docs; untested on a live server.

import { NO_THINKING, thinkingFromTemplate } from "../core/levels.ts";
import { inputModalities, listData, positiveInt, type DiscoveredModel, type EngineAdapter } from "./types.ts";

export const vllmAdapter: EngineAdapter = {
	id: "vllm",
	thinkingWire: "chat-template",
	budgetField: "thinking_token_budget",
	async discover({ origin, fetchJson, timeoutMs, headers }) {
		const models = await fetchJson(`${origin}/v1/models`, { timeoutMs, headers });
		const info = await fetchJson(`${origin}/tokenizer_info`, { timeoutMs, headers }).catch(() => undefined);
		return parseVllmModels(models, info);
	},
};

export function parseVllmModels(models: unknown, tokenizerInfo: unknown): DiscoveredModel[] {
	const template = (tokenizerInfo as { chat_template?: unknown } | undefined)?.chat_template;
	const thinking = thinkingFromTemplate(typeof template === "string" ? template : undefined) ?? NO_THINKING;
	return listData(models).flatMap((m): DiscoveredModel[] => {
		if (typeof m.id !== "string") return [];
		return [{ id: m.id, contextWindow: positiveInt(m.max_model_len), input: inputModalities(m), thinking }];
	});
}
