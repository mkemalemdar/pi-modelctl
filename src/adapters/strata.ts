// Strata (github.com/Niko1221/Strata): /v1/models for the model and its aliases, /props for the chat template.
// Aliases are other names for the same model at fixed levels; pi switches levels on the model itself, so they're
// left out.

import { NO_THINKING, thinkingFromTemplate } from "../core/levels.ts";
import { inputModalities, listData, positiveInt, type DiscoveredModel, type EngineAdapter } from "./types.ts";

export const strataAdapter: EngineAdapter = {
	id: "strata",
	thinkingWire: "chat-template",
	budgetField: "reasoning_budget_tokens",
	async discover({ origin, fetchJson, timeoutMs, headers }) {
		const models = await fetchJson(`${origin}/v1/models`, { timeoutMs, headers });
		const props = await fetchJson(`${origin}/props`, { timeoutMs, headers }).catch(() => undefined);
		return parseStrataModels(models, props);
	},
};

export function parseStrataModels(models: unknown, props: unknown): DiscoveredModel[] {
	const p = (props ?? {}) as { chat_template?: unknown; default_generation_settings?: { n_ctx?: unknown } };
	const thinking = thinkingFromTemplate(typeof p.chat_template === "string" ? p.chat_template : undefined) ?? NO_THINKING;
	return listData(models).flatMap((m): DiscoveredModel[] => {
		if (typeof m.id !== "string" || typeof m.alias_of === "string") return [];
		const meta = (m.meta ?? {}) as { n_ctx?: unknown };
		return [
			{
				id: m.id,
				contextWindow: positiveInt(meta.n_ctx) ?? positiveInt(p.default_generation_settings?.n_ctx),
				input: inputModalities(m),
				thinking,
			},
		];
	});
}
