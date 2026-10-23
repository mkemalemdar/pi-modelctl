// llama-swap: one endpoint in front of many llama-server configs. Everything comes from /v1/models, which carries
// each config's `capabilities` and `metadata`. It never asks a model for /props: that would load it.

import { NO_THINKING, thinkingFromLlamaSwapMetadata } from "../core/levels.ts";
import { inputModalities, listData, positiveInt, type DiscoveredModel, type EngineAdapter } from "./types.ts";

export const llamaSwapAdapter: EngineAdapter = {
  id: "llama-swap",
  thinkingWire: "chat-template",
  budgetField: "thinking_budget_tokens",
  async discover({ origin, fetchJson, timeoutMs, headers }) {
    return parseLlamaSwapModels(await fetchJson(`${origin}/v1/models`, { timeoutMs, headers }));
  },
};

export function parseLlamaSwapModels(body: unknown): DiscoveredModel[] {
  return listData(body).flatMap((m): DiscoveredModel[] => {
    if (typeof m.id !== "string") return [];
    const meta = (m.meta ?? {}) as { llamaswap?: { reasoning?: unknown; output_length?: unknown }; n_ctx?: unknown };
    const ls = meta.llamaswap ?? {};
    return [
      {
        id: m.id,
        contextWindow: positiveInt(m.context_length) ?? positiveInt(m.context_window) ?? positiveInt(meta.n_ctx),
        input: inputModalities(m),
        thinking: thinkingFromLlamaSwapMetadata(ls.reasoning) ?? NO_THINKING,
        maxTokensHint: positiveInt(ls.output_length),
      },
    ];
  });
}
