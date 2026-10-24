// Ollama: its own API tells what the OpenAI one doesn't. /api/tags lists the models, /api/show each one's
// capabilities (vision, thinking, embedding) and thinking options, /api/ps the context a loaded model runs with.
// Chat goes through /v1: thinking via `reasoning_effort` ("none" = off, any level word = on for on/off models,
// per Ollama's openai/openai.go). Ollama has no per-request thinking budget.
//
// Context: Ollama picks it when it loads a model (OLLAMA_CONTEXT_LENGTH, the Modelfile's num_ctx, or a default by
// VRAM; docs.ollama.com/context-length), so it's known for a loaded model or from the Modelfile, otherwise not.
// The model's trained maximum (`model_info.<arch>.context_length`) is not what Ollama runs with, so it isn't used.
// Coded according to Ollama's source and docs; untested on a live server.

import { NO_THINKING, thinkingFromOptions } from "../core/levels.ts";
import { positiveInt, type DiscoveredModel, type EngineAdapter } from "./types.ts";

export const ollamaAdapter: EngineAdapter = {
	id: "ollama",
	thinkingWire: "reasoning-effort",
	offEffort: "none",
	async discover({ origin, fetchJson, timeoutMs, headers }) {
		const tags = await fetchJson(`${origin}/api/tags`, { timeoutMs, headers });
		const ps = await fetchJson(`${origin}/api/ps`, { timeoutMs, headers }).catch(() => undefined);
		const shows = await Promise.all(
			ollamaNames(tags).map((model) => fetchJson(`${origin}/api/show`, { timeoutMs, headers, body: { model } }).catch(() => undefined)),
		);
		return parseOllamaModels(tags, shows, ps);
	},
};

/** Model names from /api/tags, in order. */
export function ollamaNames(tags: unknown): string[] {
	const models = (tags as { models?: unknown })?.models;
	if (!Array.isArray(models)) return [];
	return models.flatMap((m) => {
		const name = (m as { name?: unknown })?.name;
		return typeof name === "string" ? [name] : [];
	});
}

/** `shows[i]` is /api/show for the i-th name of /api/tags (undefined if that call failed). */
export function parseOllamaModels(tags: unknown, shows: unknown[], ps: unknown): DiscoveredModel[] {
	const running = (ps as { models?: unknown })?.models;
	const loaded = Array.isArray(running) ? (running as { name?: unknown; context_length?: unknown }[]) : [];
	return ollamaNames(tags).flatMap((id, i): DiscoveredModel[] => {
		const show = (shows[i] ?? {}) as { capabilities?: unknown; thinking?: { values?: unknown }; parameters?: unknown };
		const caps = Array.isArray(show.capabilities) ? (show.capabilities as unknown[]) : [];
		// Embedding-only models can't chat.
		if (caps.includes("embedding") && !caps.includes("completion")) return [];
		const numCtx = typeof show.parameters === "string" ? show.parameters.match(/^\s*num_ctx\s+(\d+)/m)?.[1] : undefined;
		let thinking = NO_THINKING;
		if (caps.includes("thinking")) {
			const values = Array.isArray(show.thinking?.values) ? (show.thinking.values as unknown[]) : [];
			thinking = thinkingFromOptions(values, "server metadata") ?? { kind: "onoff", canTurnOff: true, onLevel: "medium", source: "server metadata" };
		}
		return [
			{
				id,
				contextWindow: positiveInt(loaded.find((r) => r.name === id)?.context_length) ?? positiveInt(numCtx === undefined ? undefined : Number(numCtx)),
				input: caps.includes("vision") ? ["text", "image"] : ["text"],
				thinking,
			},
		];
	});
}
