// modelctl.json: defaults, reporting bad values, server rows and their names, per-model settings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultConfig, duplicateEndpoints, freeProviderName, normalizeConfig, renameProvider, setModelSetting, summaryLevelFor } from "../src/core/config.ts";
import { ENGINE_CATALOG } from "../src/core/engines.ts";

test("empty or junk input gives the defaults: every kind of server listed and off, summaries left to pi", () => {
	for (const raw of [undefined, null, 42, "x", []]) {
		const cfg = normalizeConfig(raw);
		assert.equal(cfg.engines.length, ENGINE_CATALOG.length);
		assert.ok(cfg.engines.every((e) => !e.enabled));
		assert.equal(cfg.summaryLevel, "current");
		assert.equal(cfg.statusLine, true);
		assert.deepEqual(cfg.models, {});
	}
});

test("invalid values are reported and ignored; valid ones kept", () => {
	const warnings: string[] = [];
	const cfg = normalizeConfig(
		{
			engines: [{ engine: "strata", enabled: true, port: 99999 }, { engine: "unknown" }],
			summaryLevel: "loud",
			models: {
				"no-slash": { hidden: true },
				"p/m": { contextWindow: 12, levelOnSelect: "huge", summaryLevel: "lowest", thinkingType: { kind: "maybe" }, hidden: true },
			},
		},
		warnings,
	);
	assert.equal(cfg.engines.find((e) => e.engine === "strata")!.port, 8080);
	assert.equal(cfg.summaryLevel, "current");
	assert.deepEqual(cfg.models["p/m"], { hidden: true, summaryLevel: "lowest" });
	for (const part of ["port", "unknown engine", "summaryLevel", "no-slash", "contextWindow", "levelOnSelect", "thinkingType"]) {
		assert.ok(warnings.some((w) => w.includes(part)), `a warning about ${part}`);
	}
});

test("model settings round-trip", () => {
	const cfg = normalizeConfig({
		models: { "llama-swap/small-model": { contextWindow: 20480, levelOnSelect: "medium", summaryLevel: "off", thinkingType: { kind: "levels", levels: ["low", "high"] } } },
	});
	assert.deepEqual(cfg.models["llama-swap/small-model"], { contextWindow: 20480, levelOnSelect: "medium", summaryLevel: "off", thinkingType: { kind: "levels", levels: ["low", "high"] } });
});

test("two rows with one provider name: the second is renamed (they'd share model settings)", () => {
	const warnings: string[] = [];
	const cfg = normalizeConfig({ engines: [{ engine: "llama-swap", name: "home" }, { engine: "llama-swap", name: "home" }] }, warnings);
	assert.deepEqual(cfg.engines.filter((e) => e.engine === "llama-swap").map((e) => e.name), ["home", "home-2"]);
	assert.ok(warnings.some((w) => w.includes('"home" is already used')));
	assert.equal(new Set(cfg.engines.map((e) => e.name)).size, cfg.engines.length, "every name unique");
});

test("a new row gets a free name; renaming a server moves its models' settings", () => {
	const cfg = defaultConfig();
	assert.equal(freeProviderName(cfg, "llama-swap"), "llama-swap-2");
	assert.equal(freeProviderName(cfg, "fresh"), "fresh");
	cfg.models["llama-swap/a"] = { hidden: true };
	cfg.models["llama-swap-old/b"] = { hidden: true };
	renameProvider(cfg, "llama-swap", "home");
	assert.deepEqual(Object.keys(cfg.models).sort(), ["home/a", "llama-swap-old/b"]);
});

test("setting and clearing a model's value; a model without values is dropped", () => {
	const cfg = defaultConfig();
	setModelSetting(cfg, "p/m", "summaryLevel", "lowest");
	assert.equal(summaryLevelFor(cfg, "p/m"), "lowest");
	assert.equal(summaryLevelFor(cfg, "p/other"), "current", "the value for all models");
	setModelSetting(cfg, "p/m", "summaryLevel", undefined);
	assert.equal(cfg.models["p/m"], undefined);
});

test("switched-on rows at the same address are reported", () => {
	const cfg = normalizeConfig({ engines: [{ engine: "llama-swap", enabled: true, port: 8080 }, { engine: "strata", enabled: true, port: 8080 }] });
	assert.deepEqual(duplicateEndpoints(cfg), ["llama-swap and strata both point at 127.0.0.1:8080"]);
});
