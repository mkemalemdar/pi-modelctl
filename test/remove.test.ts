// Remove everything as a whole, in its own test process (afterwards modelctl stays inert for the whole process), and
// the permissions of the files modelctl writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeEverything } from "../src/pi/remove.ts";
import { isRemoved } from "../src/pi/removed.ts";
import { loadConfig, saveJson } from "../src/pi/store.ts";

const mode = (path: string) => statSync(path).mode & 0o777;

test("files: modelctl.json is private (also an older, readable one); pi's settings.json keeps its own mode", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "modelctl-modes-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const config = join(dir, "modelctl.json");
	saveJson(config, { version: 1 }, 0o600);
	assert.equal(mode(config), 0o600);
	chmodSync(config, 0o644);
	loadConfig(config);
	assert.equal(mode(config), 0o600, "made private when read");
	const pi = join(dir, "settings.json");
	writeFileSync(pi, "{}");
	chmodSync(pi, 0o640);
	saveJson(pi, { theme: "dark" });
	assert.equal(mode(pi), 0o640, "pi's file keeps the mode it had");
	saveJson(join(dir, "new.json"), {});
	assert.equal(mode(join(dir, "new.json")), 0o600, "a new file is private");
});

test("Remove everything: modelctl.json, npm's cache, pi's values when asked; then nothing is written again", async (t) => {
	const agent = mkdtempSync(join(tmpdir(), "modelctl-remove-"));
	t.after(() => rmSync(agent, { recursive: true, force: true }));
	const dir = join(agent, "pi-modelctl");
	const config = join(dir, "modelctl.json");
	const pi = join(agent, "settings.json");
	saveJson(config, { version: 1 }, 0o600);
	writeFileSync(pi, JSON.stringify({ thinkingBudgets: { low: 1 }, theme: "dark" }));
	let cacheCleaned = 0;
	const lines = await removeEverything(true, { dir, oldConfig: join(agent, "modelctl.json"), piSettings: pi, npmCache: async () => ++cacheCleaned && 4 });
	assert.deepEqual(lines, [`✓ Deleted ${dir} (modelctl.json and the debug log).`, `✓ Reset 1 value in ${pi} to pi's defaults.`, "✓ Removed 4 cached downloads from npm's cache."]);
	assert.equal(cacheCleaned, 1);
	assert.deepEqual(JSON.parse(readFileSync(pi, "utf8")), { theme: "dark" }, "only the menu's values left pi's settings");
	assert.ok(isRemoved());
	saveJson(config, { version: 1 }, 0o600);
	assert.ok(!existsSync(config), "nothing is written again in this process");
	assert.match((await removeEverything(false, { dir, piSettings: pi, npmCache: async () => 0 })).join("\n"), /already removed/);
});
