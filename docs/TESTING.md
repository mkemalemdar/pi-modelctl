# Testing

## Unit tests

```bash
npm run check     # typecheck + unit tests
```

Node's own test runner. Recorded server answers (`test/fixtures/`) stand in for real servers; the menu is driven with
key presses and its rendered text checked (`MODELCTL_PRINT_MENUS=1` prints every screen). Tests that write files use
temporary folders and remove them. GitHub runs them on Linux and macOS for every push.

## Integration tests: a real pi against real servers

```bash
node test/integration/run.mjs [discovery budget summary small]    # no names: all, in an order that keeps model loads low
```

Each scenario starts a real pi (RPC mode) in a throwaway agent folder with its own `pi-modelctl/modelctl.json` and
pi `settings.json`. Give your servers and models in the environment or in `test/integration/.env` (git ignores it;
the environment wins):

| Variable | What |
|---|---|
| `LS_HOST`, `LS_PORT` | llama-swap (default `127.0.0.1:11434`) |
| `ST_HOST`, `ST_PORT` | Strata (default `127.0.0.1:8080`) |
| `IT_LEVELS_MODEL` | a llama-swap model with thinking levels (default `qwen3.8-27b`) |
| `IT_SMALL_MODEL` | a llama-swap on/off model with a small context, about 20K |
| `IT_STRATA_MODEL` | Strata's model |
| `IT_HIDDEN_MODEL` | any other llama-swap model, hidden in the discovery check |

| Scenario | Checks |
|---|---|
| `discovery` | a dead server doesn't slow startup and is reported; the servers' models arrive, the hidden one doesn't; the level when selected is applied |
| `budget` | the request carries pi's budget in the server's field; thinking stops near it and an answer still comes |
| `summary` | pi compacts at its own point and modelctl writes the summary at the chosen level; the chat continues |
| `small` | a small-context model with its own compaction values compacts where expected and keeps answering |

They load models on the servers, so they take minutes. Prints one `PASS` / `FAIL` / `INFO` line per check.
