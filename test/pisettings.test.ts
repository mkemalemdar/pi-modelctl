import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { budgetPath, compactionEnabled, compactionPath, compactionValue, readPath, thinkingBudget, writePath } from "../src/core/pisettings.ts";
import { readPiSettings, writePiSetting } from "../src/pi/pi-settings.ts";

test("writing one value keeps everything else; removing it removes emptied parents", () => {
  const before = { theme: "dark", compaction: { enabled: true } };
  const path = compactionPath("keepRecentTokens", "llama-swap/my-model.v2:8b");
  const after = writePath(before, path, 5000);
  assert.deepEqual(after, { theme: "dark", compaction: { enabled: true, modelOverrides: { "llama-swap/my-model.v2:8b": { keepRecentTokens: 5000 } } } });
  assert.deepEqual(before, { theme: "dark", compaction: { enabled: true } }, "the input is not changed");
  assert.equal(readPath(after, path), 5000, "model keys with dots, slashes and colons stay one key");
  assert.deepEqual(writePath(after, path, undefined), before);
  assert.deepEqual(writePath({}, budgetPath("medium"), undefined), {}, "removing what isn't there changes nothing");
});

test("compaction values as pi applies them: the model's own, then all models, then pi's default", () => {
  const s = { compaction: { reserveTokens: 8000, modelOverrides: { "p/m": { reserveTokens: 4000 } } } };
  assert.deepEqual(compactionValue(s, "reserveTokens", "p/m"), { value: 4000, source: "model" });
  assert.deepEqual(compactionValue(s, "reserveTokens", "p/other"), { value: 8000, source: "all models" });
  assert.deepEqual(compactionValue(s, "keepRecentTokens", "p/m"), { value: 20000, source: "pi's default" });
  assert.deepEqual(compactionValue({ compaction: { reserveTokens: -1 } }, "reserveTokens"), { value: 16384, source: "pi's default" }, "pi ignores invalid values");
  assert.equal(compactionEnabled({}), true);
  assert.equal(compactionEnabled({ compaction: { enabled: false } }), false);
});

test("thinking budgets per level: pi's defaults, yours, xhigh and max use high, none for off", () => {
  assert.equal(thinkingBudget({}, "medium"), 8192);
  assert.equal(thinkingBudget({ thinkingBudgets: { medium: 4096 } }, "medium"), 4096);
  assert.equal(thinkingBudget({ thinkingBudgets: { high: 30000 } }, "xhigh"), 30000);
  assert.equal(thinkingBudget({}, "max"), 16384);
  assert.equal(thinkingBudget({}, "off"), undefined);
});

test("pi's settings file: a value is written into the file; a file that can't be read is never overwritten", () => {
  const dir = mkdtempSync(join(tmpdir(), "modelctl-pisettings-"));
  const file = join(dir, "settings.json");
  assert.deepEqual(readPiSettings(file), { settings: {} }, "no file yet");
  writeFileSync(file, '﻿{"defaultModel": "x"}');
  assert.equal(writePiSetting(budgetPath("high"), 30000, file), undefined);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { defaultModel: "x", thinkingBudgets: { high: 30000 } });
  writeFileSync(file, "{ broken");
  assert.match(writePiSetting(budgetPath("high"), 1, file)!, /nothing was changed/);
  assert.equal(readFileSync(file, "utf8"), "{ broken");
});
