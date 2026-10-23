import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtExact, fmtTokens, statusLine } from "../src/core/format.ts";
import { levelName, thinkingText } from "../src/core/labels.ts";

test("token formatting", () => {
  assert.equal(fmtTokens(950), "950");
  assert.equal(fmtTokens(20480), "20.5K");
  assert.equal(fmtTokens(20000), "20K");
  assert.equal(fmtTokens(262144), "262K");
  assert.equal(fmtTokens(1048576), "1.05M");
  assert.equal(fmtExact(20480), "20,480");
});

test("status line: context, then the budget and the compaction point when there are any", () => {
  assert.equal(statusLine({ used: 41000, contextWindow: 81920, thinkingBudget: 8192, compactAt: 65536 }), "ctx 41K/81.9K · think ≤8.2K · compacts at 65.5K");
  assert.equal(statusLine({ used: null, contextWindow: 20480 }), "ctx ?/20.5K");
});

test("thinking in words; on/off models say 'on'", () => {
  assert.equal(thinkingText({ kind: "levels", levels: ["low", "xhigh"], canTurnOff: true }), "low/xhigh");
  assert.equal(thinkingText({ kind: "onoff", canTurnOff: true }), "on/off");
  assert.equal(thinkingText({ kind: "onoff", canTurnOff: false }), "always on");
  assert.equal(thinkingText({ kind: "none", canTurnOff: false }), "no thinking");
  assert.equal(levelName({ kind: "onoff", canTurnOff: true }, "medium"), "on");
  assert.equal(levelName({ kind: "levels", levels: ["low"], canTurnOff: true }, "low"), "low");
});
