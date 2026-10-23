# Writing a server adapter

An adapter teaches pi-modelctl one kind of inference server: how to list its models, what it reports about them,
and how the server switches and caps thinking. Adapters are plain objects in `src/adapters/`. They never import pi,
so they are tested with recorded (or documented) server responses and a fake `fetch`.

Kinds without an adapter of their own use the generic one (`src/adapters/openai.ts`): it lists the models, reads a
context if the server reports one, and offers no thinking switch.

## The contract (`src/adapters/types.ts`)

```ts
interface EngineAdapter {
  id: AdapterId;
  discover(opts): Promise<DiscoveredModel[]>;                  // the server's chat models
  thinkingWire: "chat-template" | "reasoning-effort" | "none"; // how the server switches thinking
  offEffort?: string;                                          // reasoning-effort servers: the word for off
  budgetField?: string;                                        // the request field that caps thinking
}
```

## What `discover` reports per model

| Field | What it is | Examples |
|---|---|---|
| `id` | The id the chat endpoint accepts | `data[].id` |
| `contextWindow` | The context the server **actually runs with**, not the model's trained maximum; undefined when unknown | llama-swap `context_length`; llama-server `/props` `default_generation_settings.n_ctx`; Strata `meta.n_ctx`; vLLM `max_model_len`; Ollama `/api/ps` `context_length` |
| `input` | Image input? | `architecture.input_modalities`, `capabilities.vision`, `/props` `modalities.vision` |
| `thinking` | none / on-off / levels, and which levels | llama-swap `metadata.reasoning`; the chat template via `thinkingFromTemplate()`; Ollama's thinking options |
| `maxTokensHint` | The server's suggested max output, if any | llama-swap `metadata.output_length` |

Rules:
- **Never make the server load a model.** llama-swap's `/upstream/<model>/props` would start it, so its adapter
  reads `/v1/models` only.
- **Don't guess.** A field the server doesn't report stays undefined. An unknown context keeps the model out of pi
  until it's set on its page.
- **Leave out aliases** that are only other names for the same model (Strata's `alias_of` entries).
- **Parse defensively:** a malformed answer gives `[]`, never a crash (`listData()`, `positiveInt()`).

## How thinking reaches the server

pi builds every request itself from the model definition (`src/core/modelconfig.ts`):

- `chat-template`: pi sends `chat_template_kwargs` (`enable_thinking`, `reasoning_effort`, `preserve_thinking`),
  read by the model's template. llama.cpp, llama-swap, Strata and vLLM.
- `reasoning-effort`: pi sends the OpenAI field `reasoning_effort` with the level's word, and `offEffort` for off.
  Ollama ("none").
- `none`: nothing.
- `budgetField`: pi sends its budget for the level in this field. **Check it:** with a small budget the model must
  stop thinking and still answer.

## Checklist

1. `src/adapters/<kind>.ts`: the adapter plus an exported `parse…()` for its responses.
2. `src/adapters/index.ts`: one line.
3. `src/core/engines.ts`: the catalog entry (id, label, default port, adapter).
4. `test/fixtures/`: record real responses (`curl … > test/fixtures/<kind>-v1-models.json`), with anything private
   removed. Without a live server, follow the documented format and say so in the README.
5. Unit tests: the parser on the fixture, a malformed body, and `discover` through a fake `fetch`.
6. README: the server table under "Discovery".
