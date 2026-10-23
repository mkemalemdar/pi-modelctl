// llama.cpp's llama-server: /v1/models for the model, /props for the context it runs with, image input and the
// chat template (which tells whether and how the model thinks).

import { NO_THINKING, thinkingFromTemplate } from "../core/levels.ts";
import { inputModalities, listData, positiveInt, type DiscoveredModel, type EngineAdapter } from "./types.ts";

export const llamaServerAdapter: EngineAdapter = {
  id: "llama-server",
  thinkingWire: "chat-template",
  budgetField: "thinking_budget_tokens",
  async discover({ origin, fetchJson, timeoutMs, headers }) {
    const models = await fetchJson(`${origin}/v1/models`, { timeoutMs, headers });
    const props = await fetchJson(`${origin}/props`, { timeoutMs, headers }).catch(() => undefined);
    return parseLlamaServerModels(models, props);
  },
};

export function parseLlamaServerModels(models: unknown, props: unknown): DiscoveredModel[] {
  const p = (props ?? {}) as { chat_template?: unknown; modalities?: { vision?: unknown }; default_generation_settings?: { n_ctx?: unknown } };
  const thinking = thinkingFromTemplate(typeof p.chat_template === "string" ? p.chat_template : undefined) ?? NO_THINKING;
  return listData(models).flatMap((m): DiscoveredModel[] => {
    if (typeof m.id !== "string") return [];
    const meta = (m.meta ?? {}) as { n_ctx?: unknown };
    return [
      {
        id: m.id,
        contextWindow: positiveInt(p.default_generation_settings?.n_ctx) ?? positiveInt(meta.n_ctx),
        input: p.modalities?.vision === true ? ["text", "image"] : inputModalities(m),
        thinking,
      },
    ];
  });
}
