// Thinking capabilities of a model, independent of the engine that serves it.
// Pure module: no pi imports, unit-tested in test/levels.test.ts.

/** pi's thinking levels, in increasing order. */
export const PI_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type PiLevel = (typeof PI_LEVELS)[number];

/** Levels that think (everything except off). */
export const THINKING_PI_LEVELS = PI_LEVELS.filter((l) => l !== "off") as Exclude<PiLevel, "off">[];

export function isPiLevel(value: unknown): value is PiLevel {
	return typeof value === "string" && (PI_LEVELS as readonly string[]).includes(value);
}

export function levelRank(level: PiLevel): number {
	return PI_LEVELS.indexOf(level);
}

/**
 * What the model can do with thinking.
 * - none:   no control (a model that never thinks, or always thinks with no switch)
 * - onoff:  a single switch, e.g. the template's `enable_thinking`
 * - levels: named effort levels, e.g. Qwen 3.8's `reasoning_effort` low / medium / xhigh
 */
export interface ThinkingSpec {
	kind: "none" | "onoff" | "levels";
	/** Effort values in the model's own words (kind "levels"). */
	levels?: string[];
	/** Whether thinking can be switched off (`enable_thinking: false`). */
	canTurnOff: boolean;
	/** The template knows `preserve_thinking` (keep earlier thinking in the history). */
	preserveThinking?: boolean;
	/** The pi level shown as "on" for on/off models. */
	onLevel?: PiLevel;
	/** Where this came from, for `/modelctl show`. */
	source?: string;
}

export const NO_THINKING: ThinkingSpec = { kind: "none", canTurnOff: false, source: "none" };

/** Default pi level used as "on" for on/off models. */
export const DEFAULT_ON_LEVEL: PiLevel = "medium";

/** Engine effort words that map 1:1 onto pi levels. */
const EFFORT_VOCAB = new Set<string>(["minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * Reads the thinking switches a Jinja chat template understands.
 *
 * Looks for `enable_thinking` (on/off), `reasoning_effort` with an explicit list of allowed values
 * (e.g. `not in ('xhigh', 'medium', 'low')`), and `preserve_thinking`. Returns undefined when the
 * template has no recognisable switch, so a caller can fall back to other sources.
 */
export function thinkingFromTemplate(template: string | undefined): ThinkingSpec | undefined {
	if (!template) return undefined;
	const hasEnable = /\benable_thinking\b/.test(template);
	const preserve = /\bpreserve_thinking\b/.test(template);
	const levels = effortLevelsFromTemplate(template);
	if (levels.length > 0) {
		return { kind: "levels", levels, canTurnOff: hasEnable, preserveThinking: preserve, source: "template" };
	}
	if (hasEnable) {
		return { kind: "onoff", canTurnOff: true, preserveThinking: preserve, onLevel: DEFAULT_ON_LEVEL, source: "template" };
	}
	return undefined;
}

/**
 * The allowed `reasoning_effort` values. Prefers an explicit membership test (`in (...)` / `in [...]`)
 * on a line about effort, because templates also mention aliases (Qwen 3.8 maps 'high' to 'xhigh').
 */
export function effortLevelsFromTemplate(template: string): string[] {
	if (!/\breasoning_effort\b/.test(template)) return [];
	const lines = template.split("\n").filter((l) => /effort/i.test(l));
	for (const line of lines) {
		const m = line.match(/\bin\s*[\(\[]([^\)\]]+)[\)\]]/);
		if (!m) continue;
		const words = [...m[1].matchAll(/['"]([a-z]+)['"]/g)].map((x) => x[1]).filter((w) => EFFORT_VOCAB.has(w));
		if (words.length > 0) return sortEffort(unique(words));
	}
	// No membership test: every effort word quoted on an effort line.
	const words = lines.flatMap((l) => [...l.matchAll(/['"]([a-z]+)['"]/g)].map((x) => x[1])).filter((w) => EFFORT_VOCAB.has(w));
	return sortEffort(unique(words));
}

/**
 * llama-swap `metadata.reasoning`, e.g. `{format: "qwen3.8", levels: ["low","medium","xhigh"]}` or
 * `{format: "qwen3.6"}` (on/off). Any `levels` array means levels; a format without levels means on/off.
 */
export function thinkingFromLlamaSwapMetadata(reasoning: unknown): ThinkingSpec | undefined {
	if (!reasoning || typeof reasoning !== "object") return undefined;
	const r = reasoning as { format?: unknown; levels?: unknown };
	if (Array.isArray(r.levels)) {
		const levels = sortEffort(unique(r.levels.filter((x): x is string => typeof x === "string" && EFFORT_VOCAB.has(x))));
		if (levels.length > 0) return { kind: "levels", levels, canTurnOff: true, preserveThinking: true, source: "server metadata" };
	}
	if (typeof r.format === "string") {
		return { kind: "onoff", canTurnOff: true, preserveThinking: /qwen/i.test(r.format), onLevel: DEFAULT_ON_LEVEL, source: "server metadata" };
	}
	return undefined;
}

/**
 * Thinking from a list of the server's thinking options, as Ollama (`/api/show` → `thinking.values`: booleans or
 * level names) and LM Studio (`capabilities.reasoning.allowed_options`: "off", "on", "low", ...) report them.
 * Level words make a levels model; otherwise any "on" value makes an on/off one. `false` / "off" = can turn off.
 */
export function thinkingFromOptions(values: unknown[], source: string): ThinkingSpec | undefined {
	const canTurnOff = values.some((v) => v === false || v === "off" || v === "none");
	const levels = sortEffort(unique(values.filter((v): v is string => typeof v === "string" && EFFORT_VOCAB.has(v))));
	if (levels.length > 0) return { kind: "levels", levels, canTurnOff, source };
	if (values.some((v) => v === true || v === "on")) return { kind: "onoff", canTurnOff, onLevel: DEFAULT_ON_LEVEL, source };
	return undefined;
}

/** Normalises a hand-written spec (from the config file). Invalid input gives undefined. */
export function thinkingFromSetting(value: unknown): ThinkingSpec | undefined {
	if (!value || typeof value !== "object") return undefined;
	const v = value as Partial<ThinkingSpec>;
	if (v.kind === "none") return { ...NO_THINKING, source: "setting" };
	if (v.kind === "onoff") {
		return {
			kind: "onoff",
			canTurnOff: true,
			preserveThinking: v.preserveThinking === true,
			onLevel: isPiLevel(v.onLevel) && v.onLevel !== "off" ? v.onLevel : DEFAULT_ON_LEVEL,
			source: "setting",
		};
	}
	if (v.kind === "levels" && Array.isArray(v.levels)) {
		const levels = sortEffort(unique(v.levels.filter((x): x is string => typeof x === "string" && EFFORT_VOCAB.has(x))));
		if (levels.length === 0) return undefined;
		return { kind: "levels", levels, canTurnOff: v.canTurnOff !== false, preserveThinking: v.preserveThinking === true, source: "setting" };
	}
	return undefined;
}

/**
 * pi's `thinkingLevelMap`: the value pi sends per level, null where the model has no such level.
 * `onValue`: what the "on" level of an on/off model sends (a template switch ignores it; `reasoning_effort` needs a
 * real word). `offValue`: what pi sends for "off", for servers that need a word for it (Ollama: "none").
 */
export function thinkingLevelMap(spec: ThinkingSpec, onValue = "on", offValue?: string): Partial<Record<PiLevel, string | null>> | undefined {
	if (spec.kind === "none") return undefined;
	const map: Partial<Record<PiLevel, string | null>> = {};
	for (const level of THINKING_PI_LEVELS) map[level] = null;
	if (spec.kind === "levels") {
		for (const value of spec.levels ?? []) map[value as PiLevel] = value;
	} else {
		const on = spec.onLevel ?? DEFAULT_ON_LEVEL;
		map[on === "off" ? DEFAULT_ON_LEVEL : on] = onValue;
	}
	if (!spec.canTurnOff) map.off = null;
	else if (offValue !== undefined) map.off = offValue;
	return map;
}

/** The pi levels a user can pick for this model, in order. */
export function availablePiLevels(spec: ThinkingSpec): PiLevel[] {
	if (spec.kind === "none") return [];
	const map = thinkingLevelMap(spec) ?? {};
	return PI_LEVELS.filter((l) => (l === "off" ? spec.canTurnOff : typeof map[l] === "string"));
}

/** The lowest pi level that still thinks (e.g. "low" on Qwen 3.8, the "on" level for on/off models). */
export function lowestThinkingLevel(spec: ThinkingSpec): PiLevel | undefined {
	return availablePiLevels(spec).find((l) => l !== "off");
}

/** Closest supported level to the wanted one (exact, else the nearest lower, else the nearest higher). */
export function clampLevel(spec: ThinkingSpec, wanted: PiLevel): PiLevel | undefined {
	const levels = availablePiLevels(spec);
	if (levels.length === 0) return undefined;
	if (levels.includes(wanted)) return wanted;
	const rank = levelRank(wanted);
	const lower = levels.filter((l) => levelRank(l) < rank);
	if (lower.length > 0) return lower[lower.length - 1];
	return levels[0];
}

function unique<T>(xs: T[]): T[] {
	return [...new Set(xs)];
}

function sortEffort(words: string[]): string[] {
	return [...words].sort((a, b) => PI_LEVELS.indexOf(a as PiLevel) - PI_LEVELS.indexOf(b as PiLevel));
}
