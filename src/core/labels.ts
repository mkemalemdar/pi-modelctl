// How the menu words a model's thinking, the summary level, and a summary whose thinking may not fit.
// Pure module: no pi imports, unit-tested in test/format.test.ts and test/compaction.test.ts.

import { MIN_ANSWER_TOKENS, type SummaryFit } from "./compaction.ts";
import type { SummaryLevel } from "./config.ts";
import { fmtExact } from "./format.ts";
import { availablePiLevels, type ThinkingSpec } from "./levels.ts";

/** "on/off", "low/medium/xhigh", "always on" or "no thinking". */
export function thinkingText(spec: ThinkingSpec): string {
	if (spec.kind === "onoff") return spec.canTurnOff ? "on/off" : "always on";
	const levels = availablePiLevels(spec).filter((l) => l !== "off");
	return levels.length ? levels.join("/") : "no thinking";
}

/** A pi level as people read it for this model: on/off models say "on" (pi calls it medium). */
export function levelName(spec: ThinkingSpec, level: string): string {
	return spec.kind === "onoff" && level !== "off" ? "on" : level;
}

export const SUMMARY_LEVEL_TEXT: Record<SummaryLevel, string> = {
	current: "same as the chat",
	lowest: "lowest that thinks",
	off: "off",
	low: "low",
	medium: "medium",
	high: "high",
};

/** What each summary level means, for the choice list. */
export const SUMMARY_LEVEL_HELP: Record<SummaryLevel, string> = {
	current: "pi writes the summary at the chat's level. modelctl doesn't step in.",
	lowest: "The model's lowest level that still thinks (on/off models: on).",
	off: "No thinking (a model that can't turn it off stays on).",
	low: "Low, or the nearest lower level the model has.",
	medium: "Medium, or the nearest lower level the model has (on/off models: on).",
	high: "High, or the model's top level if it has no high (e.g. xhigh).",
};

/**
 * The warning for a model whose summaries may think more than the room left when pi compacts, or undefined when they
 * fit. e.g. "A summary at on may think up to 8,192 tokens, but only about 4,904 are free when pi compacts …"
 */
export function summaryFitWarning(spec: ThinkingSpec, fit: SummaryFit): string | undefined {
	const free = `about ${fmtExact(fit.room)} tokens are free when pi compacts`;
	if (fit.uncapped) return `Its server takes no thinking budget, so a summary's thinking isn't capped, and ${free}. If summaries get cut off, set Summary thinking level to off.`;
	if (fit.tooBig.length === 0) return undefined;
	const most = Math.max(...fit.tooBig.map((l) => l.budget));
	const at = (level: string) => (spec.kind === "onoff" ? "with thinking on" : `at ${level}`);
	const who = fit.followsChat ? `Summaries follow the chat's level: ${spec.kind === "onoff" ? "with thinking on" : `at ${fit.tooBig.map((l) => l.level).join(" or ")}`} they` : `A summary ${at(fit.tooBig[0]!.level)}`;
	return `${who} may think up to ${fmtExact(most)} tokens, but only ${free} (pi keeps ${fmtExact(MIN_ANSWER_TOKENS)} of them for the summary itself), so a summary could be cut off. Set Summary thinking level ${spec.kind === "onoff" ? "to off" : "lower or to off"}, or raise Reserve tokens.`;
}
