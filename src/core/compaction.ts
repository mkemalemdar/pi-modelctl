// The thinking level a compaction summary is written at.
// Pure module: no pi imports, unit-tested in test/compaction.test.ts.

import type { SummaryLevel } from "./config.ts";
import { availablePiLevels, levelRank, lowestThinkingLevel, type PiLevel, type ThinkingSpec } from "./levels.ts";

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
