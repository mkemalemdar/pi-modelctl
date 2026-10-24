// Any other OpenAI-compatible server (SGLang, ...): lists the models and reads a context size if the server
// reports one. No thinking switch and no budget; a model's page can set its Thinking type and Context size.

import { NO_THINKING } from "../core/levels.ts";
import { inputModalities, listData, positiveInt, type DiscoveredModel, type EngineAdapter } from "./types.ts";

export const openaiAdapter: EngineAdapter = {
	id: "openai",
	thinkingWire: "none",
	async discover({ origin, fetchJson, timeoutMs, headers }) {
		return parseOpenAIModels(await fetchJson(`${origin}/v1/models`, { timeoutMs, headers }));
	},
};

export function parseOpenAIModels(body: unknown): DiscoveredModel[] {
	return listData(body).flatMap((m): DiscoveredModel[] => {
		if (typeof m.id !== "string") return [];
		const meta = (m.meta ?? {}) as { n_ctx?: unknown };
		return [
			{
				id: m.id,
				// vLLM-like: max_model_len; llama.cpp-like: context_length / meta.n_ctx; others: context_window.
				contextWindow: positiveInt(m.max_model_len) ?? positiveInt(m.context_length) ?? positiveInt(m.context_window) ?? positiveInt(meta.n_ctx),
				input: inputModalities(m),
				thinking: NO_THINKING,
			},
		];
	});
}
