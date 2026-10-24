# How it works

The design, for working on the extension. How a server adapter reports its models is in
[ADAPTERS.md](ADAPTERS.md).

## Principles

1. **A helper, not a controller.** It never changes a request and never takes a decision away from pi. What a server
   or pi doesn't support is left out or locked, never worked around.
2. **The server is the truth.** Context, image input and thinking come from what the server reports; a value the
   user sets wins over it. A model whose context nobody knows stays out of pi until it's set.
3. **pi's own settings stay pi's.** Thinking budgets and compaction values are edited in pi's `settings.json`, one
   value at a time, and applied by pi after `/reload`. modelctl keeps no copy.

## Source

```
src/index.ts          wiring: load the settings, discover, register the summary level, the status line and /modelctl
src/core/             pure logic, unit-tested: settings (modelctl.json), discovery's answers → pi models, thinking
                      levels, what pi gets per model, pi's settings file, compaction, labels and formatting
src/adapters/         one file per kind of server: what it's asked and what its answer means (see ADAPTERS.md)
src/pi/               pi glue: discovery, the summary level, the level on select, the status line, /modelctl and its
                      menu (ui/), pi's settings, modelctl's folder and the debug log, Remove everything (cleanup/)
```

## Startup

1. `~/.pi/agent/modelctl.json` from before 0.1.2 moves into `~/.pi/agent/pi-modelctl/` (once).
2. `modelctl.json` is read; a bad value is reported and ignored, and a file that can't be parsed is left as it is.
3. **Discovery** (in the extension's factory, which pi awaits, so the providers exist before pi picks its startup
   model): every switched-on server is asked at once, with a short timeout. Each server becomes one pi provider
   (`<name>/<model>`), registered with the models whose context is known and that aren't hidden. A server that
   doesn't answer has no models until it does; the startup notice names it.

## What pi gets per model

`src/core/modelconfig.ts` turns a discovered model and the user's values into pi's model definition:

- **Context** and **image input** as the server runs the model.
- **Thinking**: levels (e.g. off / low / medium / xhigh), on/off, or none, from the server's metadata or its chat
  template (`src/core/levels.ts`), or the user's choice. pi only offers the levels the model has.
- **The thinking budget**: pi has one budget per reasoning level; modelctl tells pi which field each server reads
  (`thinking_budget_tokens`, `reasoning_budget_tokens`, `thinking_token_budget`), and pi sends the budget for the
  current level, keeping room for the answer.

## Compaction

pi decides when and how to compact; modelctl edits pi's reserve and keep-recent values (for all models, or per model
through `compaction.modelOverrides`). The **summary thinking level** is modelctl's: when it isn't "same as the chat",
modelctl writes the summary with pi's own `compact()` at that level (`src/pi/compaction.ts`).

## Files

- `~/.pi/agent/pi-modelctl/modelctl.json`: private (600; it can hold API keys), written atomically (a temporary file
  and a rename). The folder is 700.
- pi's `~/.pi/agent/settings.json`: only the values changed in the menu, keeping its permissions and everything else.
- `~/.pi/agent/pi-modelctl/debug.log`: only with `PI_MODELCTL_DEBUG=1`: servers asked (address, answer, time), files
  written, pi values changed. Never API keys.

## Remove everything

`/modelctl` → [DANGER] → Remove everything… (or `/modelctl remove`): if asked, resets pi's values the menu edits;
marks modelctl removed (`src/pi/removed.ts`, on `globalThis`, so it holds after `/reload` too: nothing is written
again); deletes `~/.pi/agent/pi-modelctl/` and an old loose `modelctl.json`; deletes modelctl's copies in npm's cache
(`src/pi/cleanup/npm-cache.ts`, the same cleaner as pi-harness-whatsapp's); then reloads pi, so the servers' models
leave the list.
