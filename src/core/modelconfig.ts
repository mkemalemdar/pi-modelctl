// A discovered model + its settings -> pi's model definition. Everything per request (thinking switches, the
// budget field, the max reply) is then done by pi itself from this definition.
// Pure module: no pi imports, unit-tested in test/modelconfig.test.ts.

import type { DiscoveredModel, EngineAdapter } from "../adapters/types.ts";
import type { ModelSettings } from "./config.ts";
import { NO_THINKING, thinkingFromSetting, thinkingLevelMap, type ThinkingSpec } from "./levels.ts";

export interface PiModelDef {
	id: string;
	name: string;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
	thinkingLevelMap?: Record<string, string | null>;
	compat: Record<string, unknown>;
}

/** The thinking capability: a per-model setting beats what the server reported. */
export function resolveThinking(model: DiscoveredModel, settings: ModelSettings | undefined, adapter: EngineAdapter): ThinkingSpec {
	const fromSetting = thinkingFromSetting(settings?.thinkingType);
	if (fromSetting) return fromSetting;
	// A server with no way to switch thinking can't use what its template says.
	return adapter.thinkingWire === "none" ? NO_THINKING : model.thinking;
}

/** The context the server runs the model with: the per-model setting, else what the server reports, else unknown. */
export function resolveContextWindow(model: DiscoveredModel, settings: ModelSettings | undefined): number | undefined {
	return settings?.contextWindow ?? model.contextWindow;
}

/**
 * pi's model definition. pi sends `max_tokens` = this maxTokens, cut to what fits the context; the server's
 * suggested max output when it gives one, else the whole context.
 */
export function buildModelDef(model: DiscoveredModel, thinking: ThinkingSpec, contextWindow: number, adapter: EngineAdapter): PiModelDef {
	const compat: Record<string, unknown> = { maxTokensField: "max_tokens", supportsReasoningEffort: false };
	const def: PiModelDef = {
		id: model.id,
		name: model.id,
		input: model.input,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: Math.min(model.maxTokensHint ?? contextWindow, contextWindow),
		reasoning: thinking.kind !== "none",
		compat,
	};
	if (thinking.kind === "none") return def;

	if (adapter.thinkingWire === "reasoning-effort") {
		// pi sends `reasoning_effort` with the level's word, and the off word for off (Ollama: "none").
		// On/off models send "medium" for on: the server only tells on from off.
		def.thinkingLevelMap = thinkingLevelMap(thinking, "medium", adapter.offEffort) as Record<string, string | null>;
		compat.thinkingFormat = "openai";
		compat.supportsReasoningEffort = true;
	} else {
		// The chat template's own switches, as llama.cpp, Strata and vLLM read them.
		def.thinkingLevelMap = thinkingLevelMap(thinking) as Record<string, string | null>;
		compat.thinkingFormat = "chat-template";
		compat.chatTemplateKwargs = chatTemplateKwargs(thinking);
	}
	// pi sends its thinking budget for the level in this field. Strata's name isn't in pi's typed list, but pi
	// writes whatever field name it is given.
	if (adapter.budgetField) compat.thinkingTokenBudgetField = adapter.budgetField;
	return def;
}

/** The `chat_template_kwargs` pi sends, using pi's $var placeholders. */
export function chatTemplateKwargs(spec: ThinkingSpec): Record<string, unknown> {
	const kw: Record<string, unknown> = {};
	if (spec.canTurnOff) kw.enable_thinking = { $var: "thinking.enabled" };
	if (spec.kind === "levels") kw.reasoning_effort = { $var: "thinking.effort", omitWhenOff: true };
	if (spec.preserveThinking) kw.preserve_thinking = true;
	return kw;
}
