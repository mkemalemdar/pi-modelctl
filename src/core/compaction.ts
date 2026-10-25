// The thinking level a compaction summary is written at, and whether its thinking fits the room left when pi
// compacts. Pure module: no pi imports, unit-tested in test/compaction.test.ts.

import type { SummaryLevel } from "./config.ts";
import { availablePiLevels, levelRank, lowestThinkingLevel, type PiLevel, type ThinkingSpec } from "./levels.ts";
import { type BudgetLevel, PI_DEFAULT_BUDGETS } from "./pisettings.ts";

/** pi-ai keeps this much of a request's context free (its CONTEXT_SAFETY_TOKENS)… */
export const CONTEXT_SAFETY_TOKENS = 4096;
/** …and never lets thinking take the last 1,024 tokens of the output room (its MIN_ANSWER_TOKENS). */
export const MIN_ANSWER_TOKENS = 1024;

/**
 * The level for a model, or undefined to leave it to pi (the chat's own level).
 *   "current": the chat's level
 *   "lowest":  the lowest level that still thinks (on/off models: on)
 *   "off":     no thinking (stays on for a model that can't turn it off)
 *   a level:   on/off models: on; models with levels: that level, else the nearest lower one that still thinks;
 *              "high" on a model without it: its top level (e.g. xhigh)
 */
export function summaryLevel(spec: ThinkingSpec, setting: SummaryLevel): PiLevel | undefined {
	if (spec.kind === "none" || setting === "current") return undefined;
	const levels = availablePiLevels(spec);
	const thinking = levels.filter((l) => l !== "off");
	if (setting === "off") return spec.canTurnOff ? "off" : thinking[0];
	if (setting === "lowest") return lowestThinkingLevel(spec);
	if (spec.kind === "onoff") return thinking[0];
	if (levels.includes(setting)) return setting;
	if (levelRank(setting) >= levelRank("high")) return thinking[thinking.length - 1];
	return thinking.filter((l) => levelRank(l) < levelRank(setting)).pop() ?? thinking[0];
}

/** The level to write the summary at; undefined when that's the chat's current level (pi compacts as usual). */
export function compactionLevel(spec: ThinkingSpec, setting: SummaryLevel, current: PiLevel): PiLevel | undefined {
	const target = summaryLevel(spec, setting);
	return target === current ? undefined : target;
}

/**
 * The output room of a summary request when pi compacts at its usual point (context − reserve used): everything but
 * the newest `keep` tokens goes into the request, so about reserve + keep − pi-ai's safety margin is free, and never
 * more than the model's output limit.
 */
export function summaryRoom(reserve: number, keep: number, maxTokens: number): number {
	return Math.max(0, Math.min(maxTokens, reserve + keep - CONTEXT_SAFETY_TOKENS));
}

/**
 * The thinking budget pi sends with a summary at `level`: pi's default for that level (summary requests carry no
 * budgets, so the menu's don't apply; xhigh and max use high), and none for off.
 */
export function summaryBudget(level: PiLevel): number {
	if (level === "off") return 0;
	return PI_DEFAULT_BUDGETS[(level === "xhigh" || level === "max" ? "high" : level) as BudgetLevel];
}

export interface SummaryFit {
	/** The levels a summary may be written at: the summary level, or with "current" every level the chat can use. */
	levels: PiLevel[];
	/** Of those, the ones whose thinking may not leave pi's 1,024 tokens for the summary itself. */
	tooBig: { level: PiLevel; budget: number }[];
	/** The output room at compaction (see summaryRoom). */
	room: number;
	/** The server takes no thinking budget: a summary's thinking isn't capped at all. */
	uncapped: boolean;
	/** Summaries follow the chat's level ("current"). */
	followsChat: boolean;
}

/** Whether a model's summaries may think more than the room left when pi compacts. */
export function summaryThinkingFit(spec: ThinkingSpec, setting: SummaryLevel, room: number, takesBudget: boolean): SummaryFit {
	const target = summaryLevel(spec, setting);
	const levels = setting === "current" ? availablePiLevels(spec).filter((l) => l !== "off") : target && target !== "off" ? [target] : [];
	const tooBig = takesBudget ? levels.map((level) => ({ level, budget: summaryBudget(level) })).filter((l) => l.budget > room - MIN_ANSWER_TOKENS) : [];
	return { levels, tooBig, room, uncapped: !takesBudget && levels.length > 0, followsChat: setting === "current" };
}
