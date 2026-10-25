// The summary thinking level (left to pi, the lowest that thinks, off, levels a model doesn't have), and whether a
// summary's thinking fits the room left when pi compacts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compactionLevel, summaryBudget, summaryLevel, summaryRoom, summaryThinkingFit } from "../src/core/compaction.ts";
import { summaryFitWarning } from "../src/core/labels.ts";

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

test("summary room at pi's usual compaction point: reserve + keep recent − pi's 4,096, at most the output limit", () => {
	assert.equal(summaryRoom(16384, 20000, 32768), 32288);
	assert.equal(summaryRoom(4000, 5000, 8192), 4904, "a 20K model with a small reserve");
	assert.equal(summaryRoom(16384, 20000, 8192), 8192, "the model's output limit");
	assert.equal(summaryRoom(1000, 1000, 8192), 0);
});

test("a summary's thinking budget is pi's default for its level (the menu's budgets don't apply); none for off", () => {
	assert.deepEqual(["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((l) => summaryBudget(l as never)), [0, 1024, 2048, 8192, 16384, 16384, 16384]);
});

test("summaries that may think more than fits: warned with the level, the budget and the room; the rest pass", () => {
	// gemma-like: 20K on/off model, reserve 4,000, keep 5,000, "lowest" = on = medium (8,192) into ~4,904.
	const small = summaryThinkingFit(onoff, "lowest", summaryRoom(4000, 5000, 8192), true);
	assert.deepEqual(small.tooBig, [{ level: "medium", budget: 8192 }]);
	assert.match(summaryFitWarning(onoff, small) ?? "", /^A summary with thinking on may think up to 8,192 tokens, but only about 4,904 tokens are free when pi compacts \(pi keeps 1,024 of them for the summary itself\)/);
	assert.equal(summaryFitWarning(onoff, summaryThinkingFit(onoff, "off", 4904, true)), undefined, "off fits");
	// A levels model at pi's defaults: low fits easily; following the chat, only the levels that don't fit are named.
	assert.equal(summaryFitWarning(levels, summaryThinkingFit(levels, "lowest", summaryRoom(16384, 20000, 32768), true)), undefined);
	const chat = summaryThinkingFit(levels, "current", 12000, true);
	assert.deepEqual(chat.tooBig.map((l) => l.level), ["xhigh"]);
	assert.match(summaryFitWarning(levels, chat) ?? "", /^Summaries follow the chat's level: at xhigh they may think up to 16,384 tokens/);
	// A server without a budget field: the thinking isn't capped at all.
	assert.match(summaryFitWarning(levels, summaryThinkingFit(levels, "low", 32288, false)) ?? "", /takes no thinking budget, so a summary's thinking isn't capped/);
	assert.equal(summaryFitWarning(levels, summaryThinkingFit(levels, "off", 32288, false)), undefined, "off on such a server: nothing to cap");
});
