# Changelog

## 0.1.0 (unreleased)

First release.

- **Discovery** of the models on the servers you switch on: llama-swap, llama.cpp `llama-server`, Strata, Ollama,
  vLLM, and any OpenAI-compatible server. Their real context, image input and thinking levels go to pi. A model
  whose context the server doesn't report stays out of pi until it's set. Ollama and vLLM: coded according to
  their documentation, untested on live servers.
- **Thinking budget:** pi sends its own budget for the current level in each server's field
  (`thinking_budget_tokens`, `reasoning_budget_tokens`, `thinking_token_budget`); the budgets per level are edited
  in the menu.
- **pi's compaction settings** (reserve, keep recent) edited for all models or per model, in pi's own settings.
- **Summary thinking level** per model, written by pi's own `compact()`.
- **Thinking level when selected** per model, a **status line**, and per-model Hidden, Context size and Thinking
  type.
- **`/modelctl`** menu in the style of pi-harness-whatsapp, `/modelctl show`, `/modelctl reload`.
