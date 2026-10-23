// Ollama and vLLM. The responses follow each server's documented shapes (Ollama's api/types.go, vLLM's protocol
// classes); they are not recordings from a live server.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ollamaAdapter, parseOllamaModels } from "../src/adapters/ollama.ts";
import { parseVllmModels, vllmAdapter } from "../src/adapters/vllm.ts";
import type { FetchJson } from "../src/adapters/types.ts";

/** Fake server: "GET url" or "POST url model" -> body; anything else fails like a missing endpoint. */
function fakeFetch(routes: Record<string, unknown>): FetchJson {
  return async (url, init) => {
    const key = init?.body === undefined ? `GET ${url}` : `POST ${url} ${(init.body as { model?: string }).model ?? ""}`.trim();
    if (key in routes) return routes[key];
    throw new Error(`${url}: HTTP 404`);
  };
}

const O = "http://127.0.0.1:11434";
const ollama = {
  [`GET ${O}/api/tags`]: { models: [{ name: "qwen3:8b" }, { name: "gpt-oss:20b" }, { name: "nomic-embed-text:latest" }, { name: "llava:7b" }, { name: "mystery:1b" }] },
  [`GET ${O}/api/ps`]: { models: [{ name: "qwen3:8b", model: "qwen3:8b", size_vram: 1, context_length: 8192 }] },
  [`POST ${O}/api/show qwen3:8b`]: { capabilities: ["completion", "tools", "thinking"], thinking: { values: [false, true], default: true }, parameters: "temperature 0.6", model_info: { "qwen3.context_length": 40960 } },
  [`POST ${O}/api/show gpt-oss:20b`]: { capabilities: ["completion", "tools", "thinking"], thinking: { values: ["low", "medium", "high"], default: "medium" } },
  [`POST ${O}/api/show nomic-embed-text:latest`]: { capabilities: ["embedding"] },
  [`POST ${O}/api/show llava:7b`]: { capabilities: ["completion", "vision"], parameters: 'num_ctx                        4096\nstop                           "USER:"' },
};

test("Ollama: context of a loaded model, else the Modelfile's num_ctx, never the trained maximum; images and thinking from capabilities", async () => {
  const models = await ollamaAdapter.discover({ origin: O, fetchJson: fakeFetch(ollama), timeoutMs: 1000 });
  const by = Object.fromEntries(models.map((m) => [m.id, m]));
  assert.deepEqual(Object.keys(by), ["qwen3:8b", "gpt-oss:20b", "llava:7b", "mystery:1b"], "embedding-only models can't chat");
  assert.equal(by["qwen3:8b"].contextWindow, 8192, "loaded: what it runs with (not 40,960)");
  assert.deepEqual([by["qwen3:8b"].thinking.kind, by["qwen3:8b"].thinking.canTurnOff], ["onoff", true]);
  assert.deepEqual(by["gpt-oss:20b"].thinking.levels, ["low", "medium", "high"]);
  assert.equal(by["gpt-oss:20b"].thinking.canTurnOff, false, "no false among its values");
  assert.equal(by["gpt-oss:20b"].contextWindow, undefined, "not loaded, no num_ctx: unknown");
  assert.equal(by["llava:7b"].contextWindow, 4096);
  assert.deepEqual(by["llava:7b"].input, ["text", "image"]);
  assert.equal(by["mystery:1b"].thinking.kind, "none", "/api/show failed: listed, nothing known");
});

test("Ollama: only /api/tags is required; a malformed answer gives no models", async () => {
  const models = await ollamaAdapter.discover({ origin: O, fetchJson: fakeFetch({ [`GET ${O}/api/tags`]: ollama[`GET ${O}/api/tags`] }), timeoutMs: 1000 });
  assert.equal(models.length, 5);
  assert.deepEqual(parseOllamaModels({ models: "x" }, [], undefined), []);
  await assert.rejects(ollamaAdapter.discover({ origin: O, fetchJson: fakeFetch({}), timeoutMs: 1000 }));
});

const V = "http://127.0.0.1:8000";
const QWEN_TEMPLATE = "{%- if enable_thinking is defined and enable_thinking is false %}<think>\n\n</think>{%- endif %}";

test("vLLM: max_model_len is the context; thinking from /tokenizer_info when the server shares it", async () => {
  const list = { object: "list", data: [{ id: "Qwen/Qwen3-8B", object: "model", owned_by: "vllm", max_model_len: 32768 }, { id: "my-lora", parent: "Qwen/Qwen3-8B" }] };
  const models = await vllmAdapter.discover({ origin: V, fetchJson: fakeFetch({ [`GET ${V}/v1/models`]: list, [`GET ${V}/tokenizer_info`]: { chat_template: QWEN_TEMPLATE } }), timeoutMs: 1000 });
  assert.deepEqual(models.map((m) => [m.id, m.contextWindow, m.thinking.kind]), [["Qwen/Qwen3-8B", 32768, "onoff"], ["my-lora", undefined, "onoff"]]);
  assert.equal(parseVllmModels(list, undefined)[0].thinking.kind, "none", "no template shared: thinking unknown");
});
