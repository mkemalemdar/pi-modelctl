# Installing (and uninstalling) pi-modelctl: notes for AI agents

This file is for an AI agent (pi, Claude Code, Codex, …) asked to install or remove this extension for a user. Read it
fully before changing anything. **Asked to remove it?** Go to [Uninstalling](#uninstalling).

## What you can and can't do

- **You can:**
  - check this computer and the user's model servers, and install the package
  - ask the user which servers they run, and write modelctl's settings file for them
- **You can't:**
  - use the `/modelctl` menu: it's an interactive terminal UI meant for the user
  - change pi's own settings (thinking budgets, compaction) unless the user asks: those are pi's, and modelctl only
    edits them when the user does

## 1. Check the machine

Do these yourself before asking anything, so your questions can include the results.

- **pi** 1.3 or newer: `pi --version`.
- **Command conflicts:** this extension registers `/modelctl`. List what's registered:
  ```bash
  echo '{"type":"get_commands"}' | pi --mode rpc | grep '"get_commands"'
  ```
  If another package registers `/modelctl`, tell the user it has to go first, and ask before removing it.
- **Other packages that add the same servers** (e.g. a llama-swap provider extension, or the same server in
  `~/.pi/agent/models.json`): with both, the models show up twice. Tell the user and ask which should stay.
- **The servers:** for each address the user gives (or the usual ones on this computer), ask the server for its
  models, without a key unless the user gave one:
  ```bash
  curl -s --max-time 3 http://127.0.0.1:8080/v1/models | head -c 400      # llama-swap, llama-server, Strata, vLLM, others
  curl -s --max-time 3 http://127.0.0.1:11434/api/tags | head -c 400      # Ollama
  ```
  Say which ones answered, and with how many models.

## 2. Ask the basics

Ask these together, in one message, and wait for the answers:

1. **Which servers?** For each one: the kind (llama-swap, llama.cpp `llama-server`, Strata, Ollama, vLLM, SGLang, or
   another OpenAI-compatible server), its host and port, and an API key if it needs one. Include what your check
   found.
2. **Models without a known context:** Ollama only reports the context of a loaded model; vLLM, SGLang and other
   servers may not say it. Such a model stays out of pi until its context size is set. Ask what context the server
   runs it with, or tell them they can set it later in `/modelctl` → All models.

## 3. Offer the other settings

Then show these in **one** message, with the defaults, and ask which they want changed ("defaults are fine" is a fine
answer; everything can be changed later in `/modelctl`):

| Setting (name in `/modelctl`) | What it does | Default | Other choices |
|---|---|---|---|
| Summary thinking level | The thinking level pi writes compaction summaries at | **same as the chat** (modelctl stays out of it) | lowest that thinks · off · low · medium · high |
| Status line | `ctx 41K/81.9K · think ≤8.2K · compacts at 65.5K` in pi's footer | **on** | off |
| Hidden (per model) | Keeps a model out of pi's model list | **no** | yes |
| Thinking level when selected (per model) | The level pi switches to when the model is picked | **keep the current one** | a pi level |

Thinking budgets and compaction (reserve, keep recent) are pi's own settings, edited in the same menu; mention that
they exist, and leave them unless the user asks.

## 4. Install

```bash
pi install npm:pi-modelctl
pi list    # should show npm:pi-modelctl
```

## 5. Write the settings

Settings live in `~/.pi/agent/pi-modelctl/modelctl.json` (`$PI_CODING_AGENT_DIR/pi-modelctl/` if that's set). Unknown
or invalid values are reported when pi starts and ignored. Make the folder private (`chmod 700`) and the file too
(`chmod 600`): it can hold API keys. If a pi with this extension is running, ask the user to quit it first.

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
    "ollama/qwen3:8b": { "contextWindow": 8192 },
    "llama-swap/old-model": { "hidden": true }
  }
}
```

| Field | Setting | Values |
|---|---|---|
| `engines` | Servers | `engine`: `llama-swap` · `llama-server` · `strata` · `ollama` · `vllm` · `sglang` · `openai`; `enabled`; `host`; `port` (defaults: 8080, 8080, 8080, 11434, 8000, 30000, 8000); `name` (unique: it's the pi provider name, as in `name/model`); `apiKey` (optional, sent as a Bearer token, exactly as typed) |
| `summaryLevel` | Summary thinking level | `current` (default) · `lowest` · `off` · `low` · `medium` · `high` |
| `statusLine` | Status line | boolean, default `true` |
| `models` | per model, keyed `provider/model` | `hidden` (boolean) · `contextWindow` (tokens) · `levelOnSelect` (`off` · `minimal` · `low` · `medium` · `high` · `xhigh` · `max`) · `summaryLevel` |

Leave out a model's thinking type: if the server reports it wrong, the user picks it in the menu.

## 6. Hand over to the user

Tell the user:

1. Start pi: `pi`. A startup notice names any server that isn't answering.
2. Pick a model with `/model`. Their servers' models are listed as `<server name>/<model>`.
3. `/modelctl` opens the menu: servers, thinking budgets, compaction, and each model's page. `/modelctl show` lists
   the values the current model uses.

## Check it worked

- `pi --list-models` shows the servers' models.
- `/modelctl show` lists each server with its number of models, and no "isn't answering".

## Never do this

- Don't put an API key anywhere but `apiKey` in modelctl.json, and don't print it.
- Don't change pi's `settings.json` (thinking budgets, compaction) unless the user asks.
- Don't switch on servers the user didn't name.
- Don't publish, fork or re-upload this package on the user's behalf.
- Don't edit or delete pi's session files (`~/.pi/agent/sessions/`).

## Uninstalling

Goal: **nothing left behind** on this computer. Follow these steps in order. Don't improvise extra deletions.

### What the extension leaves on a computer

| What | Where | Removed by |
|---|---|---|
| The code | pi's package folder, plus an entry in `~/.pi/agent/settings.json` | `pi uninstall` |
| Its settings and the debug log | `~/.pi/agent/pi-modelctl/` (before 0.1.2: `~/.pi/agent/modelctl.json`) | "Remove everything", or deleting them |
| Values set in its menu | pi's `~/.pi/agent/settings.json`: `thinkingBudgets`, `compaction.reserveTokens` / `keepRecentTokens`, also per model | "Remove everything", second choice (only if the user wants them gone) |
| Copies of it in npm's cache | `~/.npm/_cacache` | "Remove everything" (only its own entries) |

### Steps

1. **Look first, change nothing yet:** `pi list` (note the exact source).
2. **Tell the user what will be removed, ask whether pi's values set in the menu should go too, and get a yes.**
3. **Clean up from inside pi.** Ask the user to close every other pi window. Then either the user runs `/modelctl` →
   **[DANGER] › Remove everything…** (or types `/modelctl remove`) and picks a choice, or you do it over RPC: start
   `pi --mode rpc` and send
   ```json
   {"id": "1", "type": "prompt", "message": "/modelctl remove"}
   ```
   It asks two `"method": "confirm"` questions: "Remove everything?" and then whether to reset pi's values set in the
   menu. Show the user each `title` and `message`, and answer with their decision:
   `{"type": "extension_ui_response", "id": "<the request's id>", "confirmed": true}` (or `false`). The last `notify`
   starts with `modelctl removed.`: show it to them, then close stdin.
4. **Remove the code:** `pi uninstall <source from step 1>`, with pi not running.
5. **Verify, and show the user the output** (all empty):
   ```bash
   pi list | grep -i modelctl
   ls -a ~/.pi/agent/pi-modelctl ~/.pi/agent/modelctl.json 2>/dev/null
   ```

### What stays, on purpose; don't delete it

- **pi's own settings** when the user didn't ask to reset them.
- **pi's sessions:** chats keep the names of the models they used, as pi records them.
- **The model servers** and everything on them: modelctl only asked them for their models.

## Troubleshooting

See the README's **Troubleshooting** section.
