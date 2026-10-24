// pi's own settings.json: reading and writing one value, the values pi applies, and resetting the menu's ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { budgetPath, compactionEnabled, menuValuePaths, compactionPath, compactionValue, readPath, thinkingBudget, writePath } from "../src/core/pisettings.ts";
import { readPiSettings, resetMenuValues, writePiSetting } from "../src/pi/pi-settings.ts";
import { removeFiles } from "../src/pi/remove.ts";

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

test("pi's settings file: a value is written into the file; a file that can't be read is never overwritten", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "modelctl-pisettings-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const file = join(dir, "settings.json");
	assert.deepEqual(readPiSettings(file), { settings: {} }, "no file yet");
	writeFileSync(file, '﻿{"defaultModel": "x"}');
	assert.equal(writePiSetting(budgetPath("high"), 30000, file), undefined);
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { defaultModel: "x", thinkingBudgets: { high: 30000 } });
	writeFileSync(file, "{ broken");
	assert.match(writePiSetting(budgetPath("high"), 1, file)!, /nothing was changed/);
	assert.equal(readFileSync(file, "utf8"), "{ broken");
});

test("the menu's values in pi's settings: found (also per model) and reset; everything else stays", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "modelctl-reset-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const file = join(dir, "settings.json");
	const other = { defaultModel: "x", compaction: { enabled: false, modelOverrides: { "a/b": { reserveTokens: 1, keepRecentTokens: 2, other: 3 }, "c/d": { reserveTokens: 4 } } } };
	const mine = { thinkingBudgets: { low: 100, high: 200 }, compaction: { reserveTokens: 5 } };
	const settings = { ...other, ...mine, compaction: { ...other.compaction, ...mine.compaction } };
	assert.deepEqual(menuValuePaths(settings), [budgetPath("low"), budgetPath("high"), compactionPath("reserveTokens"), compactionPath("reserveTokens", "a/b"), compactionPath("keepRecentTokens", "a/b"), compactionPath("reserveTokens", "c/d")]);
	writeFileSync(file, JSON.stringify(settings));
	assert.deepEqual(resetMenuValues(file), { removed: 6 });
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { defaultModel: "x", compaction: { enabled: false, modelOverrides: { "a/b": { other: 3 } } } });
	assert.deepEqual(resetMenuValues(file), { removed: 0 }, "nothing left to reset");
	writeFileSync(file, "{ broken");
	assert.ok("error" in resetMenuValues(file));
	assert.equal(readFileSync(file, "utf8"), "{ broken", "never overwritten");
});

test("Remove everything's file part: modelctl's folder and an old loose modelctl.json; nothing else in pi's folder", (t) => {
	const agent = mkdtempSync(join(tmpdir(), "modelctl-remove-"));
	t.after(() => rmSync(agent, { recursive: true, force: true }));
	const dir = join(agent, "pi-modelctl");
	const old = join(agent, "modelctl.json");
	mkdirSync(dir);
	writeFileSync(join(dir, "modelctl.json"), "{}");
	writeFileSync(join(dir, "debug.log"), "log");
	writeFileSync(old, "{}");
	writeFileSync(`${old}.tmp-123`, "{");
	writeFileSync(join(agent, "modelctl.json.bak"), "kept: not ours");
	writeFileSync(join(agent, "settings.json"), "{}");
	assert.deepEqual(removeFiles(dir, old), [`✓ Deleted ${dir} (modelctl.json and the debug log).`, `✓ Deleted the old ${old}.`]);
	assert.ok(!existsSync(dir) && !existsSync(old) && !existsSync(`${old}.tmp-123`));
	assert.ok(existsSync(join(agent, "modelctl.json.bak")) && existsSync(join(agent, "settings.json")), "pi's folder keeps everything else");
	assert.deepEqual(removeFiles(dir, old), [`✓ ${dir} wasn't there.`]);
});
