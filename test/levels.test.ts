import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  availablePiLevels,
  clampLevel,
  effortLevelsFromTemplate,
  lowestThinkingLevel,
  thinkingFromLlamaSwapMetadata,
  thinkingFromSetting,
  thinkingFromTemplate,
  thinkingLevelMap,
} from "../src/core/levels.ts";

const strataTemplate = JSON.parse(readFileSync(new URL("./fixtures/strata-props.json", import.meta.url), "utf8")).chat_template as string;

test("Qwen 3.8 template (Strata): levels low/medium/xhigh, can turn off, preserve_thinking", () => {
  const spec = thinkingFromTemplate(strataTemplate)!;
  assert.equal(spec.kind, "levels");
  assert.deepEqual(spec.levels, ["low", "medium", "xhigh"]);
  assert.equal(spec.canTurnOff, true);
  assert.equal(spec.preserveThinking, true);
});

test("template alias 'high' (mapped to xhigh in the template) is not reported as a level", () => {
  // Regression: a naive scan of quoted words picked up the alias line `== 'high'`.
  assert.ok(!effortLevelsFromTemplate(strataTemplate).includes("high"));
});

test("template with only enable_thinking is on/off", () => {
  const spec = thinkingFromTemplate("{% if enable_thinking %}<think>{% endif %}")!;
  assert.equal(spec.kind, "onoff");
  assert.equal(spec.canTurnOff, true);
  assert.deepEqual(availablePiLevels(spec), ["off", "medium"]);
});

test("template without switches gives undefined (caller falls back)", () => {
  assert.equal(thinkingFromTemplate("{{ messages }}"), undefined);
  assert.equal(thinkingFromTemplate(undefined), undefined);
});

test("template without a membership list falls back to quoted effort words", () => {
  const t = "{% set e = reasoning_effort|default('low') %}\n{% if reasoning_effort == 'high' %}x{% endif %}";
  assert.deepEqual(effortLevelsFromTemplate(t), ["low", "high"]);
  // Quoted words on lines that never mention effort are not levels.
  assert.deepEqual(effortLevelsFromTemplate("{% set e = reasoning_effort %}\n{% if e == 'high' %}x{% endif %}"), []);
});

test("llama-swap metadata: qwen3.8 with levels, qwen3.6 on/off, junk ignored", () => {
  const l = thinkingFromLlamaSwapMetadata({ format: "qwen3.8", levels: ["xhigh", "low", "medium", "bogus"] })!;
  assert.equal(l.kind, "levels");
  assert.deepEqual(l.levels, ["low", "medium", "xhigh"]);
  const o = thinkingFromLlamaSwapMetadata({ format: "qwen3.6" })!;
  assert.equal(o.kind, "onoff");
  assert.equal(thinkingFromLlamaSwapMetadata(undefined), undefined);
  assert.equal(thinkingFromLlamaSwapMetadata("x"), undefined);
});

test("thinkingLevelMap marks unsupported levels null and keeps off allowed", () => {
  const map = thinkingLevelMap({ kind: "levels", levels: ["low", "medium", "xhigh"], canTurnOff: true })!;
  assert.equal(map.low, "low");
  assert.equal(map.high, null);
  assert.equal(map.minimal, null);
  assert.equal(map.off, undefined);
  const noOff = thinkingLevelMap({ kind: "levels", levels: ["low"], canTurnOff: false })!;
  assert.equal(noOff.off, null);
});

test("available, lowest and clamped levels", () => {
  const spec = { kind: "levels" as const, levels: ["low", "medium", "xhigh"], canTurnOff: true };
  assert.deepEqual(availablePiLevels(spec), ["off", "low", "medium", "xhigh"]);
  assert.equal(lowestThinkingLevel(spec), "low");
  assert.equal(clampLevel(spec, "high"), "medium");
  assert.equal(clampLevel(spec, "minimal"), "off");
  assert.equal(clampLevel(spec, "max"), "xhigh");
  assert.equal(clampLevel({ kind: "none", canTurnOff: false }, "low"), undefined);
});

test("hand-written thinking setting", () => {
  assert.equal(thinkingFromSetting({ kind: "onoff", onLevel: "high" })!.onLevel, "high");
  assert.deepEqual(thinkingFromSetting({ kind: "levels", levels: ["high", "low"] })!.levels, ["low", "high"]);
  assert.equal(thinkingFromSetting({ kind: "levels", levels: [] }), undefined);
  assert.equal(thinkingFromSetting({ kind: "none" })!.kind, "none");
  assert.equal(thinkingFromSetting("nope"), undefined);
});
