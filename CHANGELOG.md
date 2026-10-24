# Changelog

## 0.1.2 — 2026-10-24

- **modelctl's files live in their own folder,** `~/.pi/agent/pi-modelctl/`. An existing `~/.pi/agent/modelctl.json`
  moves there by itself the next time pi starts.
- **A debug log:** start pi with `PI_MODELCTL_DEBUG=1` and `~/.pi/agent/pi-modelctl/debug.log` records the servers
  asked (address, answer, time), the files written and pi's values changed. Never API keys.
- **AGENT_INSTALL.md:** what an AI agent installing (or removing) it for someone checks, asks and writes.
- The README has Requirements and Troubleshooting sections.
- Development: docs/HOW-IT-WORKS.md and docs/TESTING.md; the integration test reads a git-ignored `.env`.

## 0.1.1 — 2026-10-24

- **Remove everything** in the menu's new DANGER section (also `/modelctl remove`), before uninstalling: deletes
  modelctl.json and modelctl's copies in npm's cache, and if you choose, the values the menu set in pi's settings
  (thinking budgets, compaction reserve and keep recent). Afterwards modelctl writes nothing more in that pi.
- **modelctl.json is private** (only your user can read it, as it can hold an API key); an existing one is fixed the
  next time pi starts. pi's own settings.json keeps the permissions it had when modelctl changes a value in it.
- Development: the type check and unit tests run on GitHub for every push, on Linux and macOS.

## 0.1.0 — 2026-10-23

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
