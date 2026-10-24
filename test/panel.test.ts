// Drives the real /modelctl screens with a fake terminal: renders text and presses keys. pi's settings.json is an
// in-memory object here. MODELCTL_PRINT_MENUS=1 prints every screen the tests visit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig } from "../src/core/config.ts";
import { modelEntries, originOf } from "../src/core/discover.ts";
import { writePath } from "../src/core/pisettings.ts";
import type { DiscoveredModel } from "../src/adapters/types.ts";
import { Runtime } from "../src/pi/runtime.ts";
import { showPanel, type PanelHost } from "../src/pi/ui/panel.ts";

const KEY = { up: "\x1b[A", down: "\x1b[B", enter: "\r", esc: "\x1b", space: " ", backspace: "\x7f" };
const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s };

const MODELS: Record<string, DiscoveredModel[]> = {
  "llama-swap": [
    { id: "levels-model", contextWindow: 81920, input: ["text"], thinking: { kind: "levels", levels: ["low", "medium", "xhigh"], canTurnOff: true, source: "server metadata" } },
    { id: "small-model", contextWindow: 20480, input: ["text", "image"], thinking: { kind: "onoff", canTurnOff: true, onLevel: "medium", source: "server metadata" } },
  ],
  ollama: [{ id: "mystery:1b", input: ["text"], thinking: { kind: "onoff", canTurnOff: true, onLevel: "medium", source: "server metadata" } }],
};

function setup(opts: { serversOn?: boolean; selected?: string } = {}) {
  const on = opts.serversOn ?? true;
  const rt = new Runtime(normalizeConfig({ engines: [{ engine: "llama-swap", enabled: on, port: 8080 }, { engine: "ollama", enabled: on }] }), []);
  let piFile: Record<string, unknown> = {};
  const rediscover = async () => {
    rt.catalog.clear();
    for (const row of rt.config.engines.filter((r) => r.enabled)) {
      for (const e of modelEntries({ row, origin: originOf(row), models: MODELS[row.engine] ?? [] }, rt.config)) rt.catalog.set(e.key, e);
    }
    return { servers: [], warnings: [] };
  };
  void rediscover();
  let saves = 0;
  const host: PanelHost = {
    pi: { getSettings: () => ({}), getThinkingLevel: () => "medium" } as unknown as PanelHost["pi"],
    rt,
    save: () => void saves++,
    rediscover,
    refreshStatus: () => {},
    piSettings: {
      read: () => ({ settings: piFile }),
      write: (path, value) => void (piFile = writePath(piFile, path, value)),
    },
  };
  let comp: { render(w: number): string[]; handleInput(d: string): void } | undefined;
  let result: unknown = "open";
  const [provider, id] = (opts.selected ?? "llama-swap/levels-model").split("/");
  const ctx = {
    model: { provider, id },
    ui: {
      custom: (factory: (...a: unknown[]) => typeof comp) =>
        new Promise((res) => {
          comp = factory({ requestRender: () => {}, terminal: { rows: 80 } }, theme, {}, (r: unknown) => {
            result = r;
            res(r);
          });
        }),
    },
  };
  void showPanel(ctx as unknown as Parameters<typeof showPanel>[0], host);
  // Without the terminal's cursor markers.
  const screen = () => comp!.render(100).join("\n").replace(/\x1b_[^\x07]*\x07/g, "");
  const press = (...keys: string[]) => {
    for (const k of keys) comp!.handleInput(k);
    if (process.env.MODELCTL_PRINT_MENUS === "1") console.log(`${screen()}\n`);
  };
  const type = (text: string) => press(...text.split(""));
  /** Moves to the row whose label is exactly `label`, then presses Enter. */
  const open = (label: string) => {
    for (let i = 0; i < 80; i++) {
      const row = screen().split("\n").find((l) => l.includes("→ "));
      const text = row?.replace(/^.*→ /, "").replace(/^[●\s]+|\[[x ]\]\s/g, "").trimStart();
      if (text === label || text?.startsWith(`${label}  `)) return press(KEY.enter);
      comp!.handleInput(KEY.down);
    }
    throw new Error(`no row "${label}" in:\n${screen()}`);
  };
  const settle = () => new Promise((r) => setImmediate(r));
  /** The screen with whitespace collapsed, for checking prose wherever it wraps. */
  const flat = () => screen().replace(/\s+/g, " ");
  return { rt, screen, flat, press, type, open, settle, piFile: () => piFile, saves: () => saves, result: () => result };
}

test("main page: GENERAL SETTINGS (pi's budgets and compaction, the status line), MODELS, EXTENSION", () => {
  const p = setup();
  const s = p.screen();
  assert.equal(s.split("\n")[1].trim(), "", "a gap under the title line");
  for (const row of [
    /\[GENERAL SETTINGS\]\s+for every model/,
    /Thinking budgets\s+minimal 1K · low 2K · medium 8.2K · high 16.4K/,
    /Compaction\s+summary same as the chat · reserve 16,384 · keep 20,000/,
    /Status line\s+on/,
    /levels-model\s+selected now · no own settings/,
    /All models\s+2 in pi · 1 need a context size/,
    /Servers\s+2 on · 3 models/,
    /Reload/,
  ])
    assert.match(s, row);
  assert.doesNotMatch(s, /START HERE|Loop guard|Reply length/);
});

test("first run: START HERE leads to Servers", () => {
  const p = setup({ serversOn: false });
  assert.match(p.screen(), /\[START HERE\]\n\s*→\s+Pick your server\s+none switched on yet/);
  p.open("Pick your server");
  assert.match(p.screen(), /── modelctl › Servers ─/);
  p.press(KEY.space);
  assert.equal(p.rt.config.engines[0].enabled, true);
});

test("thinking budgets are pi's: a value goes into pi's settings, empty removes it", () => {
  const p = setup();
  p.open("Thinking budgets");
  assert.match(p.screen(), /medium\s+8,192 · pi's default/);
  p.open("medium");
  p.type("4096");
  p.press(KEY.enter);
  assert.deepEqual(p.piFile(), { thinkingBudgets: { medium: 4096 } });
  assert.match(p.screen(), /medium\s+saved · applies after Reload/);
  p.press(KEY.up, KEY.down);
  assert.match(p.screen(), /medium\s+4,096 · after Reload/, "pi hasn't loaded it yet");
  p.open("medium");
  p.press(...KEY.backspace.repeat(4).split(""), KEY.enter);
  assert.deepEqual(p.piFile(), {});
  p.open("high");
  p.type("lots");
  p.press(KEY.enter);
  assert.match(p.screen(), /A whole number of tokens/);
});

test("compaction for all models: summary level in modelctl, reserve and keep recent in pi's settings", () => {
  const p = setup();
  p.open("Compaction");
  assert.match(p.flat(), /On levels-model \(81,920\): compacts at 65,536 used, keeps the newest 20,000\./);
  p.open("Summary thinking level");
  assert.match(p.screen(), /● same as the chat\s+default/);
  p.open("lowest that thinks");
  assert.equal(p.rt.config.summaryLevel, "lowest");
  p.open("Reserve tokens");
  p.type("8000");
  p.press(KEY.enter);
  assert.deepEqual(p.piFile(), { compaction: { reserveTokens: 8000 } });
});

test("a 20K model: pi's defaults compact at 4,096 and keep 20,000; per-model values fix it", () => {
  const p = setup({ selected: "llama-swap/small-model" });
  p.open("small-model");
  assert.match(p.flat(), /compacts at 4,096 used, keeps the newest 20,000\. Keep recent is at least that much, so a compaction can't free anything/);
  p.open("Reserve tokens");
  assert.match(p.screen(), /This model's context is 20,480/);
  p.type("4000");
  p.press(KEY.enter);
  p.open("Keep recent");
  p.type("5000");
  p.press(KEY.enter);
  assert.deepEqual(p.piFile(), { compaction: { modelOverrides: { "llama-swap/small-model": { reserveTokens: 4000, keepRecentTokens: 5000 } } } });
  assert.match(p.screen(), /Keep recent\s+saved · applies after Reload/);
  assert.match(p.flat(), /small-model on llama-swap\. On small-model \(20,480\): compacts at 16,480 used, keeps the newest 5,000\. \[MODEL\]/, "the note follows the new values");
  p.press(KEY.up, KEY.down);
  assert.match(p.screen(), /Reserve tokens\s+4,000 · own · after Reload/);
  p.open("Reserve tokens");
  p.press(...KEY.backspace.repeat(5).split(""));
  p.type("30000");
  p.press(KEY.enter);
  assert.match(p.screen(), /0 to 20,480/, "not above the model's context");
});

test("a model's summary level: own, then 'Same as all models' removes it", () => {
  const p = setup();
  p.open("levels-model");
  assert.match(p.screen(), /Summary thinking level\s+same as the chat · all models/);
  p.open("Summary thinking level");
  p.open("off");
  assert.equal(p.rt.config.models["llama-swap/levels-model"]?.summaryLevel, "off");
  assert.match(p.screen(), /Summary thinking level\s+off · own/);
  p.open("Summary thinking level");
  p.open("Same as all models");
  assert.equal(p.rt.config.models["llama-swap/levels-model"], undefined);
});

test("a server without a thinking budget: the row is locked and says why", () => {
  const p = setup();
  p.open("All models");
  p.open("mystery:1b");
  assert.match(p.screen(), /Thinking budget\s+not supported by Ollama/);
  p.open("Thinking budget");
  assert.match(p.screen(), /Ollama takes no thinking budget/);
  assert.doesNotMatch(p.screen(), /── modelctl › Thinking budgets ─/);
});

test("a model whose context nobody knows: listed but not in pi until its size is set", async () => {
  const p = setup();
  p.open("All models");
  assert.match(p.screen(), /mystery:1b\s+context unknown · on\/off/);
  p.open("mystery:1b");
  assert.match(p.screen(), /Context size\s+unknown: set it to use this model/);
  p.open("Context size");
  p.press(KEY.enter);
  assert.match(p.screen(), /The server doesn't say it: type the size/);
  p.type("8192");
  p.press(KEY.enter);
  assert.equal(p.rt.config.models["ollama/mystery:1b"]?.contextWindow, 8192);
  await p.settle();
  assert.equal(p.rt.catalog.get("ollama/mystery:1b")?.def?.contextWindow, 8192, "now in pi");
});

test("thinking type and the level when selected (on/off models read 'on')", () => {
  const p = setup({ selected: "llama-swap/small-model" });
  p.open("small-model");
  assert.match(p.screen(), /Thinking type\s+on\/off · from the server/);
  p.open("Thinking level when selected");
  assert.match(p.screen(), /Keep the current one[^\n]*\n\s+off\n\s+on\n/);
  p.open("on");
  assert.equal(p.rt.config.models["llama-swap/small-model"]?.levelOnSelect, "medium", "stored as pi's level");
  p.open("Thinking type");
  p.open("Levels…");
  p.press(KEY.esc);
  assert.deepEqual(p.rt.config.models["llama-swap/small-model"]?.thinkingType, { kind: "levels", levels: ["low", "medium", "high"] });
  assert.match(p.screen(), /── modelctl › Models › small-model ─/);
});

test("servers: an added row gets its own name; renaming moves the models' settings; the API key is plain", () => {
  const p = setup();
  p.rt.config.models["llama-swap/small-model"] = { hidden: true };
  p.open("Servers");
  assert.match(p.screen(), /\[x\] llama-swap\s+127\.0\.0\.1:8080 · 2 models/);
  p.open("[ Add a server ]");
  p.open("llama-swap");
  assert.equal(p.rt.config.engines.at(-1)!.name, "llama-swap-2");
  p.press(KEY.esc);
  assert.match(p.screen(), /\[ \] llama-swap \(llama-swap-2\)\s+127\.0\.0\.1:8080/);
  p.open("llama-swap");
  p.open("Provider name");
  p.press(...KEY.backspace.repeat(12).split(""));
  p.type("llama-swap-2");
  p.press(KEY.enter);
  assert.match(p.screen(), /Another server is already called llama-swap-2\./);
  p.press(...KEY.backspace.repeat(12).split(""));
  p.type("home");
  p.press(KEY.enter);
  assert.deepEqual(p.rt.config.models["home/small-model"], { hidden: true });
  p.open("API key");
  p.type("$not-an-env-var");
  p.press(KEY.enter);
  assert.equal(p.rt.config.engines[0].apiKey, "$not-an-env-var");
});

test("Status line switches on Enter; Esc closes; Reload closes with 'reload'", () => {
  const p = setup();
  p.open("Status line");
  assert.equal(p.rt.config.statusLine, false);
  p.press(KEY.esc);
  assert.equal(p.result(), undefined);
  const q = setup();
  q.open("Reload");
  assert.equal(q.result(), "reload");
});

test("DANGER › Remove everything: Cancel (the default) and Esc go back; each removal choice closes with it", () => {
  const p = setup();
  assert.match(p.screen(), /\[DANGER\]\n\s*Remove everything…/);
  p.open("Remove everything…");
  assert.match(p.screen(), /── modelctl › Remove everything ─/);
  assert.match(p.screen(), /→ Cancel/, "Cancel is preselected");
  p.press(KEY.enter);
  assert.match(p.screen(), /── modelctl ─/);
  p.open("Remove everything…");
  p.press(KEY.esc);
  assert.match(p.screen(), /── modelctl ─/);
  assert.equal(p.result(), "open");
  p.open("Remove everything…");
  p.open("Remove modelctl.json");
  assert.deepEqual(p.result(), { remove: true, resetPi: false });
  const q = setup();
  q.open("Remove everything…");
  q.open("Remove modelctl.json and reset pi's values set here");
  assert.deepEqual(q.result(), { remove: true, resetPi: true });
});
