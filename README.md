# pi-modelctl

A [pi](https://pi.dev) extension for self-hosted models. It's a helper: it never changes a request and never
takes a decision away from pi. It:

- **finds your models** on the servers you switch on (llama-swap, llama.cpp, Strata, Ollama, vLLM, any
  OpenAI-compatible server) and adds them to pi with their real context, image input and thinking levels;
- **puts a stopper on thinking**: pi sends its thinking budget for the current level, in the field each server
  reads;
- **sets pi's compaction per model**: when pi compacts and how much it keeps, so a small-context model compacts
  at a sensible point;
- **writes the compaction summary at the thinking level you choose**, per model;
- switches to a model's own **thinking level when you select it**, and shows a **status line**
  (`ctx 41K/81.9K · think ≤8.2K · compacts at 65.5K`).

## Install

```bash
pi install npm:pi-modelctl
```

1. Start pi and type `/modelctl`. The menu opens on **Pick your server**: press Enter.
2. Move to the kind of server you run and press **Space** to switch it on. modelctl asks it for its models right
   away and shows how many it found.
3. Server on another machine or port? Press **Enter** on its row and change Host or Port.
4. Press Esc and pick a model with `/model`. Your models are listed as `<server>/<model>`.

That's it: the defaults work as they are. If a model's page says its **Context size** is unknown (Ollama only
reports it for a loaded model), enter the size your server runs it with. Until then the model stays out of pi.

## What it does

### Finding your models

modelctl asks the servers you switched on, all at once with a short timeout. Each server becomes one pi provider.
A server that doesn't answer has no models in pi until it does; the startup notice and `/modelctl show` say
which one.

| Server | Default port | What it reads | Thinking budget field |
|---|---|---|---|
| llama-swap | 8080 | `/v1/models`: context, image input, thinking levels, max output | `thinking_budget_tokens` |
| llama.cpp `llama-server` | 8080 | `/v1/models` + `/props`: context, image input, chat template | `thinking_budget_tokens` |
| Strata | 8080 | `/v1/models` + `/props`: context, image input, chat template | `reasoning_budget_tokens` |
| Ollama | 11434 | `/api/tags`, `/api/show` (images, thinking options), `/api/ps` (a loaded model's context) or the Modelfile's `num_ctx` | none |
| vLLM | 8000 | `/v1/models` (context); the chat template from `/tokenizer_info` when it runs with `--enable-tokenizer-info-endpoint` | `thinking_token_budget` (needs `--reasoning-parser`) |
| SGLang, other | 30000 / 8000 | `/v1/models`: the context, if reported | none |

**Ollama and vLLM: coded according to their documentation, untested on live servers.**

- **Context:** the one the server actually runs the model with, never the model's trained maximum. When the server
  doesn't say, the model shows as *context unknown* and stays out of pi until you set it.
- **Thinking levels:** pi only offers what the model has: levels (e.g. off / low / medium / xhigh), on/off, or
  none. When a server doesn't say (vLLM without `--enable-tokenizer-info-endpoint`, SGLang, other servers), or says
  it wrong, set **Thinking type** on the model's page.

### Thinking budget

pi has one thinking budget per reasoning level, the same for every model: minimal 1,024, low 2,048, medium 8,192
and high 16,384 tokens by default (xhigh and max use high). modelctl tells pi which field each server reads, and pi
sends the budget for the current level, always keeping 1,024 tokens for the answer. Change the budgets under
**Thinking budgets**. On a server without a budget field (Ollama, generic), thinking can't be capped; the model's
page says so.

Checked on llama.cpp (via llama-swap) with Qwen 3.8 27B: the budget stops the thinking, the model still answers,
and it overrides a `--reasoning-budget` set on the server.

### Compaction

pi decides when and how to compact. modelctl edits pi's own values for you, and can pick the summary's thinking
level:

- **Reserve tokens** (pi's default 16,384): pi compacts once only this many tokens are left. On a 20K model that's
  at 4,096 tokens used, far too early.
- **Keep recent** (pi's default 20,000): how much of the newest conversation stays word for word. On a 20K model
  that's the whole context, so a compaction can't free anything.
- Set both for all models or per model. For a 20K model, reserve 4,000 and keep recent 5,000 compact at about
  16,500 and keep the newest 5,000.
- **Summary thinking level:** the level the summary is written at: same as the chat (the default; modelctl stays
  out of it), lowest that thinks, off, low, medium or high. A model without that level uses the nearest one it has.

### Status line

`ctx 41K/81.9K · think ≤8.2K · compacts at 65.5K`: the context used, the budget pi sends at the current level, and
where pi compacts. It can be switched off on the main page.

## The menu

`/modelctl` opens it. Enter opens a row, Esc goes back, and the highlighted row is explained underneath.

```
── modelctl ────────────────────────────────────────────────────────────────

    [GENERAL SETTINGS]  for every model
  →   Thinking budgets  minimal 1K · low 2K · medium 8.2K · high 16.4K
      Compaction        summary same as the chat · reserve 16,384 · keep 20,000
      Status line       on

    [MODELS]
      small-model       selected now · no own settings
      All models        7 in pi

    [EXTENSION]
      Servers           2 on · 7 models
      Reload
```

A model's page, here a 20K model with pi's defaults:

```
── modelctl › Models › small-model ─────────────────────────────────────────

  small-model on llama-swap. On small-model (20,480): compacts at 4,096 used,
  keeps the newest 20,000. Keep recent is at least that much, so a compaction
  can't free anything: lower it, or the reserve.

    [MODEL]
  →   Hidden                        no
      Context size                  20,480 · from the server
      Thinking type                 on/off · from the server
      Thinking level when selected  keep the current one

    [THINKING BUDGET]
      Thinking budget               pi's thinking budget per reasoning level

    [COMPACTION]                    own, or the same as all models
      Summary thinking level        same as the chat · all models
      Reserve tokens                16,384 · pi's default
      Keep recent                   20,000 · pi's default
```

Thinking budgets, Reserve tokens and Keep recent are **pi's own settings**. The menu shows what's in pi's
`settings.json` and writes only the value you change (empty = back to the default). pi applies them after
**Reload**. modelctl keeps no copy.

| Command | Effect |
|---|---|
| `/modelctl` | the menu |
| `/modelctl show` | the servers, and the values the current model uses and where each comes from |
| `/modelctl reload` | pi's `/reload` |

## Files

| File | What | Written |
|---|---|---|
| `~/.pi/agent/modelctl.json` | the servers, the summary level, the status line switch, per-model choices | when you change something in the menu |
| `~/.pi/agent/settings.json` (pi's) | only the values you change under Thinking budgets and Compaction | when you change one |

```json
{
  "version": 1,
  "engines": [
    { "engine": "llama-swap", "enabled": true, "host": "127.0.0.1", "port": 8080, "name": "llama-swap" },
    { "engine": "ollama", "enabled": true, "host": "192.0.2.10", "port": 11434, "name": "ollama", "apiKey": "sk-…" }
  ],
  "summaryLevel": "current",
  "statusLine": true,
  "models": {
    "llama-swap/small-model": { "summaryLevel": "lowest", "levelOnSelect": "medium" },
    "ollama/qwen3:8b": { "contextWindow": 8192 },
    "llama-swap/old-model": { "hidden": true }
  }
}
```

An API key is sent as a Bearer token, exactly as typed. A value modelctl can't use is reported at startup and
ignored; the file is only written when you change something in the menu.

## Development

```
src/index.ts      wiring
src/core/         pure logic (settings, discovery, thinking levels, pi's settings file), unit-tested
src/adapters/     one file per kind of server
src/pi/           pi glue: discovery, summary level, level on select, status line, the command, the menu
test/             unit tests (node:test); test/integration/ drives a real pi against real servers
```

```bash
npm run check     # typecheck + unit tests
```

To add a kind of server: an entry in `src/core/engines.ts`, an adapter in `src/adapters/` and one line in
`src/adapters/index.ts`. [docs/ADAPTERS.md](docs/ADAPTERS.md) explains what an adapter reports.

## Limits

- pi applies its own settings (budgets, reserve, keep recent) after `/reload`, not instantly.
- Thinking budgets are per level and the same for every model; that's how pi's setting works.
- pi writes compaction summaries outside extension hooks, so a summary isn't capped by a budget.
- Other clients (e.g. Open WebUI) don't run this extension.

## Credits

Writing the summary at another thinking level with pi's `compact()` follows
[pi-compaction-model](https://github.com/JMHSV/pi-compaction-model) (MIT). Ideas from pi-llama-swap,
@pinet/model-aware-compaction and pi-yari.

## License

MIT
