// How the menu words a model's thinking and the summary level.
// Pure module: no pi imports, unit-tested in test/labels.test.ts.

import type { SummaryLevel } from "./config.ts";
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
