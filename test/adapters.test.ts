import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLlamaSwapModels } from "../src/adapters/llama-swap.ts";
import { parseStrataModels } from "../src/adapters/strata.ts";
import { parseLlamaServerModels } from "../src/adapters/llama-server.ts";
import { parseOpenAIModels } from "../src/adapters/openai.ts";
import { adapterFor } from "../src/adapters/index.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

test("llama-swap (recorded): 6 models, context from capabilities, levels from metadata", () => {
  const models = parseLlamaSwapModels(fixture("llama-swap-v1-models.json"));
  const byId = Object.fromEntries(models.map((m) => [m.id, m]));
  assert.equal(models.length, 6);
  assert.equal(byId["qwen3.8-27b"].contextWindow, 81920);
  assert.equal(byId["qwen3.8-27b"].thinking.kind, "levels");
  assert.deepEqual(byId["qwen3.8-27b"].thinking.levels, ["low", "medium", "xhigh"]);
  assert.equal(byId["small-model"].thinking.kind, "onoff");
  assert.equal(byId["small-model"].contextWindow, 20480);
  assert.deepEqual(byId["small-model"].input, ["text", "image"]);
  assert.equal(byId["small-model"].maxTokensHint, 8192);
});

test("Strata (recorded): the model only (no aliases), levels from its template", () => {
  const models = parseStrataModels(fixture("strata-v1-models.json"), fixture("strata-props.json"));
  assert.equal(models.length, 1);
  assert.equal(models[0].id, "big-model");
  assert.equal(models[0].contextWindow, 262144);
  assert.equal(models[0].thinking.kind, "levels");
  assert.deepEqual(models[0].input, ["text", "image"]);
});

test("Strata without /props: model still listed, thinking unknown", () => {
  const models = parseStrataModels(fixture("strata-v1-models.json"), undefined);
  assert.equal(models[0].thinking.kind, "none");
});

test("llama-server single model: n_ctx and vision from /props", () => {
  const models = parseLlamaServerModels(
    { data: [{ id: "m.gguf", object: "model" }] },
    { default_generation_settings: { n_ctx: 32768 }, modalities: { vision: true }, chat_template: "{% if enable_thinking %}{% endif %}" },
  );
  assert.equal(models[0].contextWindow, 32768);
  assert.deepEqual(models[0].input, ["text", "image"]);
  assert.equal(models[0].thinking.kind, "onoff");
});

test("generic OpenAI: vLLM max_model_len, no thinking", () => {
  const models = parseOpenAIModels({ data: [{ id: "Qwen/Qwen3-8B", max_model_len: 40960 }, { id: 5 }, "junk"] });
  assert.equal(models.length, 1);
  assert.equal(models[0].contextWindow, 40960);
  assert.equal(models[0].thinking.kind, "none");
});

test("malformed bodies give no models instead of throwing", () => {
  for (const body of [undefined, null, {}, { data: "x" }, []]) {
    assert.deepEqual(parseLlamaSwapModels(body), []);
    assert.deepEqual(parseOpenAIModels(body), []);
  }
});

test("adapter registry: dedicated adapters, others fall back to generic; each names its budget field", () => {
  assert.equal(adapterFor("strata").budgetField, "reasoning_budget_tokens");
  assert.equal(adapterFor("llama-swap").budgetField, "thinking_budget_tokens");
  assert.equal(adapterFor("llama-server").budgetField, "thinking_budget_tokens");
  assert.equal(adapterFor("vllm").budgetField, "thinking_token_budget");
  assert.equal(adapterFor("openai").budgetField, undefined);
  assert.equal(adapterFor("llama-swap").id, "llama-swap");
  assert.equal(adapterFor("vllm").id, "vllm");
  assert.equal(adapterFor("ollama").id, "ollama");
  assert.equal(adapterFor("sglang").id, "openai");
  assert.equal(adapterFor("ollama").budgetField, undefined);
});
