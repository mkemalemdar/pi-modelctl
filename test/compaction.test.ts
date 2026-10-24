// The summary thinking level: left to pi, the lowest that thinks, off, and levels a model doesn't have.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compactionLevel, summaryLevel } from "../src/core/compaction.ts";

const levels = { kind: "levels" as const, levels: ["low", "medium", "xhigh"], canTurnOff: true };
const onoff = { kind: "onoff" as const, canTurnOff: true, onLevel: "medium" as const };

test("'current' and models that don't think: left to pi", () => {
	assert.equal(summaryLevel(levels, "current"), undefined);
	assert.equal(summaryLevel({ kind: "none", canTurnOff: false }, "lowest"), undefined);
});

test("lowest = the lowest level that thinks (on for on/off models); undefined when it's the chat's level", () => {
	assert.equal(compactionLevel(levels, "lowest", "xhigh"), "low");
	assert.equal(compactionLevel(levels, "lowest", "low"), undefined);
	assert.equal(compactionLevel(onoff, "lowest", "off"), "medium", "lowest thinking on an on/off model is on, not off");
});

test("off, and levels the model doesn't have", () => {
	assert.equal(compactionLevel(levels, "off", "xhigh"), "off");
	assert.equal(compactionLevel({ ...onoff, canTurnOff: false }, "off", "off"), "medium", "can't turn off: stays on");
	assert.equal(compactionLevel(levels, "medium", "xhigh"), "medium");
	assert.equal(compactionLevel(levels, "high", "low"), "xhigh", "no high: the top level");
	assert.equal(compactionLevel(onoff, "high", "off"), "medium", "on/off: any level means on");
	assert.equal(compactionLevel({ kind: "levels", levels: ["medium", "high"], canTurnOff: false }, "low", "high"), "medium", "below the lowest: the lowest");
});
