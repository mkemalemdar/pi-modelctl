// modelctl's folder: the one-time move of an old loose modelctl.json, and the debug log (only when asked, no keys).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agent = mkdtempSync(join(tmpdir(), "modelctl-store-"));
process.env.PI_CODING_AGENT_DIR = agent;
process.env.PI_MODELCTL_DEBUG = "1";
const { configPath, dataDir, fetchJson, loadConfig, moveOldConfig, oldConfigPath, saveJson } = await import("../src/pi/store.ts");
const mode = (path: string) => statSync(path).mode & 0o777;

test("an old modelctl.json (before 0.1.2) moves into modelctl's folder, once; a second copy is reported, not used", (t) => {
	t.after(() => rmSync(agent, { recursive: true, force: true }));
	assert.equal(dataDir(), join(agent, "pi-modelctl"));
	assert.equal(moveOldConfig(), undefined, "nothing to move");
	writeFileSync(oldConfigPath(), JSON.stringify({ version: 1, statusLine: false }));
	assert.equal(moveOldConfig(), undefined);
	assert.ok(!existsSync(oldConfigPath()) && existsSync(configPath()));
	assert.equal(loadConfig().config.statusLine, false, "the settings came along");
	assert.equal(mode(configPath()), 0o600);
	assert.equal(mode(dataDir()), 0o700);
	writeFileSync(oldConfigPath(), "{}");
	assert.match(moveOldConfig() ?? "", /is from an older modelctl and isn't used/);
	assert.ok(existsSync(oldConfigPath()), "left for you to delete");
	rmSync(oldConfigPath());

	// The debug log: in modelctl's folder, what was written and asked, never an API key.
	saveJson(configPath(), { version: 1 }, 0o600);
	const logFile = join(dataDir(), "debug.log");
	assert.match(readFileSync(logFile, "utf8"), /\[files\] (moved|wrote) .*modelctl\.json/);
	assert.equal(mode(logFile), 0o600);
});

test("the debug log records servers asked (address and answer), never the key sent with them", async (t) => {
	t.after(() => rmSync(agent, { recursive: true, force: true }));
	mkdirSync(dataDir(), { recursive: true });
	await fetchJson("http://127.0.0.1:9/v1/models", { headers: { Authorization: "Bearer sk-secret-key" }, timeoutMs: 500 }).catch(() => {});
	const text = readFileSync(join(dataDir(), "debug.log"), "utf8");
	assert.match(text, /\[http\] GET http:\/\/127\.0\.0\.1:9\/v1\/models failed/);
	assert.doesNotMatch(text, /sk-secret-key/);
});
