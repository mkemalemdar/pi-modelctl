// Discovery: the servers' models with their settings, servers that don't answer, API keys, IPv6 hosts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { askServer, authHeaders, modelEntries, originOf, piLiteral } from "../src/core/discover.ts";
import { normalizeConfig } from "../src/core/config.ts";
import type { FetchJson } from "../src/adapters/types.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

/** Fake server: URL -> body, anything else fails like a closed port. */
function fakeFetch(routes: Record<string, unknown>, calls: { url: string; headers?: Record<string, string> }[] = []): FetchJson {
	return async (url, init) => {
		calls.push({ url, headers: init?.headers });
		if (url in routes) return routes[url];
		throw new Error(`connect ECONNREFUSED ${url}`);
	};
}

const cfg = normalizeConfig({
	engines: [
		{ engine: "llama-swap", enabled: true, port: 11434, name: "llama-swap" },
		{ engine: "strata", enabled: true, port: 8080, name: "strata" },
	],
	models: { "llama-swap/agent-model": { hidden: true }, "strata/big-model": { levelOnSelect: "low" } },
});
const swap = cfg.engines.find((r) => r.name === "llama-swap")!;
const strata = cfg.engines.find((r) => r.name === "strata")!;

test("recorded llama-swap answer: every model with its settings; hidden ones flagged", async () => {
	const answer = await askServer(swap, fakeFetch({ "http://127.0.0.1:11434/v1/models": fixture("llama-swap-v1-models.json") }), 1000);
	const entries = modelEntries(answer, cfg);
	assert.equal(entries.length, 6);
	assert.ok(entries.every((e) => e.def && e.key === `llama-swap/${e.model.id}`));
	assert.deepEqual(entries.filter((e) => e.hidden).map((e) => e.key), ["llama-swap/agent-model"]);
});

test("recorded Strata answer: the model with its template's levels", async () => {
	const routes = { "http://127.0.0.1:8080/v1/models": fixture("strata-v1-models.json"), "http://127.0.0.1:8080/props": fixture("strata-props.json") };
	const [coder] = modelEntries(await askServer(strata, fakeFetch(routes), 1000), cfg);
	assert.equal(coder.key, "strata/big-model");
	assert.equal(coder.def?.contextWindow, 262144);
	assert.deepEqual(coder.thinking.levels, ["low", "medium", "xhigh"]);
});

test("a server that doesn't answer gives no models and says why (never throws)", async () => {
	const answer = await askServer(swap, fakeFetch({}), 1000);
	assert.deepEqual(answer.models, []);
	assert.match(answer.error!, /ECONNREFUSED/);
});

test("a model whose context nobody knows gets no pi definition until it's set", () => {
	const answer = { row: swap, origin: originOf(swap), models: [{ id: "mystery", input: ["text"] as ("text" | "image")[], thinking: { kind: "none" as const, canTurnOff: false } }] };
	assert.equal(modelEntries(answer, cfg)[0].def, undefined);
	const withSize = normalizeConfig({ ...cfg, models: { "llama-swap/mystery": { contextWindow: 16384 } } });
	assert.equal(modelEntries(answer, withSize)[0].def?.contextWindow, 16384);
});

test("API key: sent as typed to the server; escaped for pi so $ and ! aren't read as pi's syntax", async () => {
	const calls: { url: string; headers?: Record<string, string> }[] = [];
	await askServer({ ...swap, apiKey: "sk-1" }, fakeFetch({}, calls), 1000);
	assert.deepEqual(calls[0].headers, { Authorization: "Bearer sk-1" });
	assert.equal(authHeaders(swap), undefined);
	assert.equal(piLiteral("sk-plain"), "sk-plain");
	assert.equal(piLiteral("a$b$$c"), "a$$b$$$$c");
	assert.equal(piLiteral("!secret"), "$!secret");
});

test("IPv6 hosts get brackets", () => {
	assert.equal(originOf({ ...swap, host: "::1", port: 8080 }), "http://[::1]:8080");
});
