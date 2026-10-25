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

> 🤖 **AI agent installing or removing this for someone?** Read [AGENT_INSTALL.md](AGENT_INSTALL.md) first: what to
> check and ask, how to write the settings, how to uninstall without leaving anything behind, and what never to touch.

## Requirements

- pi 1.3 or newer.
- A model server pi can reach: llama-swap, llama.cpp's `llama-server`, Strata, Ollama, vLLM, or any
  OpenAI-compatible server, on this computer or another one.

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
page says so. These budgets are for the chat: a compaction summary gets pi's default budget for its level instead
(see [Compaction](#compaction)).

Checked on llama.cpp (via llama-swap) with Qwen 3.8 27B, a model that thinks very long: the budget stops the thinking, the model still answers,
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
- **A summary's thinking budget:** pi sends no budgets with a summary request, so its thinking is capped at pi's
  default for the summary's level (low 2,048, medium 8,192, high 16,384; an on/off model thinks at medium), not at
  the menu's budgets. When pi compacts at its usual point, about reserve + keep recent − 4,096 tokens are free for
  the thinking and the summary together, and pi keeps 1,024 of them for the summary. When a summary may think more
  than that, the model's page (and `/modelctl show`) warns. The 20K example above is one: with thinking on, set its
  summary level to off.
- The compaction record notes the level modelctl wrote a summary at (`summaryLevel` in its details), and the debug
  log names, for every compaction, who wrote the summary at which level.

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

    [DANGER]
      Remove everything…
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
| `/modelctl remove` | Remove everything, without the menu (see [Uninstall](#uninstall)) |

## Files

| File | What | Written |
|---|---|---|
| `~/.pi/agent/pi-modelctl/modelctl.json` | the servers, the summary level, the status line switch, per-model choices; private (mode 600), since it can hold an API key | when you change something in the menu |
| `~/.pi/agent/pi-modelctl/debug.log` | only with `PI_MODELCTL_DEBUG=1` (see [Troubleshooting](#troubleshooting)) | while it's on |
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
ignored; the file is only written when you change something in the menu. Before 0.1.2, modelctl.json lived in
`~/.pi/agent/` itself; it's moved into the folder by itself the next time pi starts.

## Uninstall

1. **Clean up from inside pi.** Close every other pi window that uses modelctl. Then open `/modelctl` →
   **[DANGER] › Remove everything…** (or type `/modelctl remove`). It offers two choices:
   - **Remove modelctl.json:** modelctl's folder (your servers and every per-model choice, and the debug log), and
     modelctl's copies in npm's download cache. pi's own settings stay as they are.
   - **Remove modelctl.json and reset pi's values set here:** also removes the thinking budgets and the compaction
     reserve / keep recent (for all models and per model) from pi's `settings.json`, so pi uses its defaults again.
     Everything else in that file stays. These values go even if you set them some other way.

   pi then reloads, your servers' models leave its list, and modelctl writes nothing more until you quit.
2. **Quit pi and remove the code:**
   ```bash
   pi uninstall npm:pi-modelctl
   ```

### What isn't removed, on purpose

- **pi's own settings** when you pick the first choice: they're pi's, not modelctl's.
- **Your pi sessions:** chats keep the names of the models they used, as pi records them.

## Troubleshooting

- **"<server> isn't answering":** the server is off, or Host or Port are wrong: `/modelctl` → Servers → the server's
  row. A server that doesn't answer has no models in pi until it does.
- **A model is missing from `/model`:** its server didn't say how big its context is (Ollama only says it for a loaded
  model). Open `/modelctl` → All models → the model, and set **Context size**.
- **A budget or compaction value didn't change anything:** those are pi's own settings, applied after **Reload**.
- **"… is from an older modelctl and isn't used":** both the old `~/.pi/agent/modelctl.json` and the one in
  `~/.pi/agent/pi-modelctl/` exist; the one in the folder is used. Delete the old one.
- **More detail:** start pi with `PI_MODELCTL_DEBUG=1 pi`. It writes `~/.pi/agent/pi-modelctl/debug.log`: each server
  asked (its address, the answer and how long it took), the files written and pi's values changed. Never API keys.

## Limits

- pi applies its own settings (budgets, reserve, keep recent) after `/reload`, not instantly.
- Thinking budgets are per level and the same for every model; that's how pi's setting works.
- A compaction summary's thinking is capped by pi's default budget for its level, not by the budgets set in the
  menu: pi sends no budgets with summary requests.
- Other clients (e.g. Open WebUI) don't run this extension.

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
`src/adapters/index.ts`. [docs/ADAPTERS.md](docs/ADAPTERS.md) explains what an adapter reports,
[docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md) the design, [docs/TESTING.md](docs/TESTING.md) the tests, and
[AGENT_INSTALL.md](AGENT_INSTALL.md) what an AI agent installing it does.

## Credits

Writing the summary at another thinking level with pi's `compact()` follows
[pi-compaction-model](https://github.com/JMHSV/pi-compaction-model) (MIT). Ideas from pi-llama-swap,
@pinet/model-aware-compaction and pi-yari.

## License

MIT
