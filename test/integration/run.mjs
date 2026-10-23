// Integration checks against real servers (llama-swap on :11434, Strata on :8080 by default) and a real pi.
// Each scenario gets its own throwaway pi agent dir with its own modelctl.json and pi settings.json.
// Usage: node test/integration/run.mjs [scenario ...]    (no args = all, in an order that keeps model loads low)
// Prints one line per check: PASS / FAIL / INFO.
//
// Point it at models on your servers:
//   IT_LEVELS_MODEL  a llama-swap model with thinking levels (default qwen3.8-27b)
//   IT_SMALL_MODEL   a llama-swap on/off model with a small context, ~20K (default small-model)
//   IT_STRATA_MODEL  Strata's model (default big-model)
//   IT_HIDDEN_MODEL  any other llama-swap model, hidden in the discovery check (default agent-model)

import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pi } from "./rpc.mjs";

const LS = { engine: "llama-swap", enabled: true, host: process.env.LS_HOST ?? "127.0.0.1", port: Number(process.env.LS_PORT ?? 11434), name: "llama-swap" };
const ST = { engine: "strata", enabled: true, host: process.env.ST_HOST ?? "127.0.0.1", port: Number(process.env.ST_PORT ?? 8080), name: "strata" };
const M = {
  levels: process.env.IT_LEVELS_MODEL ?? "qwen3.8-27b",
  small: process.env.IT_SMALL_MODEL ?? "small-model",
  strata: process.env.IT_STRATA_MODEL ?? "big-model",
  hidden: process.env.IT_HIDDEN_MODEL ?? "agent-model",
};
const results = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`;
  results.push(line);
  console.log(line);
};
const info = (name, detail) => console.log(`INFO  ${name}  ${detail}`);

/** A pi session in a fresh agent dir: `config` is modelctl.json (servers added), `piSettings` pi's settings.json. */
async function session({ config = {}, piSettings } = {}, fn) {
  const dir = mkdtempSync(join(tmpdir(), "modelctl-it-"));
  const src = process.env.PI_CODING_AGENT_DIR;
  if (src && existsSync(join(src, "auth.json"))) cpSync(join(src, "auth.json"), join(dir, "auth.json"));
  writeFileSync(join(dir, "modelctl.json"), JSON.stringify({ version: 1, engines: [LS, ST], ...config }, null, 2));
  if (piSettings) writeFileSync(join(dir, "settings.json"), JSON.stringify(piSettings, null, 2));
  // The model has tools: give it a scratch working folder, never the repo.
  const work = join(dir, "work");
  mkdirSync(work);
  const pi = new Pi({ probeLog: join(dir, "probe.jsonl"), cwd: work, env: { PI_CODING_AGENT_DIR: dir } });
  try {
    await fn(pi);
  } finally {
    await pi.close();
  }
}

const WORDS = ["river", "mill", "copper", "lantern", "harbor", "violet", "granite", "meadow", "signal", "orchard", "falcon", "ember", "quiet", "northern", "bridge", "candle", "silver", "window"];
const fillerChars = (chars) => {
  let s = "";
  for (let i = 0; s.length < chars; i++) s += `${WORDS[i % 18]} ${WORDS[(i * 7 + 3) % 18]} ${WORDS[(i * 13 + 5) % 18]}${i % 5 === 4 ? ".\n" : ", "}`;
  return s.slice(0, chars);
};
/** Filler of about `tokens` real tokens for `model`, measured with the server's own tokenizer (the model must be loaded). */
async function filler(model, tokens) {
  const sample = fillerChars(20000);
  const res = await fetch(`http://${LS.host}:${LS.port}/upstream/${model}/tokenize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: sample }) });
  const n = (await res.json()).tokens.length;
  return fillerChars(Math.floor((tokens * sample.length) / n));
}
const lastOf = (pi, t) => pi.probe().filter((r) => r.t === t).at(-1);

const SCENARIOS = {
  // No requests, no GPU: models, levels, level on select, a dead server.
  async discovery() {
    const t0 = Date.now();
    await session(
      {
        config: {
          engines: [LS, ST, { engine: "vllm", enabled: true, host: "127.0.0.1", port: 1, name: "deadvllm" }],
          models: { [`strata/${M.strata}`]: { levelOnSelect: "low" }, [`llama-swap/${M.hidden}`]: { hidden: true } },
        },
      },
      async (pi) => {
        const models = (await pi.send({ type: "get_available_models" })).data?.models ?? [];
        const ids = models.map((m) => `${m.provider}/${m.id}`);
        check("startup with a dead server is fast", Date.now() - t0 < 15000, `${Date.now() - t0} ms`);
        check("discovery: llama-swap's and Strata's models, the hidden one left out", ids.includes(`strata/${M.strata}`) && ids.includes(`llama-swap/${M.levels}`) && !ids.includes(`llama-swap/${M.hidden}`), ids.join(", "));
        const expect = { [`llama-swap/${M.levels}`]: "off,low,medium,xhigh", [`llama-swap/${M.small}`]: "off,medium", [`strata/${M.strata}`]: "off,low,medium,xhigh" };
        for (const [key, want] of Object.entries(expect)) {
          const [provider, modelId] = key.split(/\/(.*)/s);
          await pi.send({ type: "set_model", provider, modelId });
          const got = ((await pi.send({ type: "get_available_thinking_levels" })).data?.levels ?? []).join(",");
          check(`levels ${key}`, got === want, got);
        }
        await pi.send({ type: "set_model", provider: "llama-swap", modelId: M.levels });
        await pi.send({ type: "set_thinking_level", level: "xhigh" });
        await pi.send({ type: "set_model", provider: "strata", modelId: M.strata });
        const state = (await pi.send({ type: "get_state" })).data;
        check("level when selected applied", state?.thinkingLevel === "low", `level ${state?.thinkingLevel}`);
        check("dead server reported", pi.notifications().some((n) => n.includes("deadvllm")), pi.notifications().join(" | "));
      },
    );
  },

  // pi sends its own budget for the level in the server's field (here thinking_budget_tokens).
  async budget() {
    await session({ piSettings: { thinkingBudgets: { medium: 600 } } }, async (pi) => {
      await pi.send({ type: "set_model", provider: "llama-swap", modelId: M.levels });
      await pi.send({ type: "set_thinking_level", level: "medium" });
      await pi.prompt("How many prime numbers are there between 1 and 300? Work it out carefully, then give the count.");
      const req = lastOf(pi, "request");
      const asst = lastOf(pi, "assistant");
      check("the request carries pi's medium budget (600) in thinking_budget_tokens", req?.thinking_budget_tokens === 600, `${req?.thinking_budget_tokens}`);
      check("thinking stopped near the budget and an answer came", asst?.stop === "stop" && asst.textChars > 0 && asst.usage.output < 3000, `output ${asst?.usage?.output}, answer ${asst?.textChars} chars`);
    });
  },

  // pi compacts when it decides to (here early: a large reserve); modelctl writes the summary at the level set.
  async summary() {
    await session({ config: { summaryLevel: "lowest" }, piSettings: { compaction: { reserveTokens: 70000, keepRecentTokens: 2000 } } }, async (pi) => {
      await pi.send({ type: "set_model", provider: "llama-swap", modelId: M.levels });
      await pi.send({ type: "set_thinking_level", level: "xhigh" });
      await pi.prompt('Remember this code word: BLUE-SEVEN. Reply only "noted".');
      await pi.prompt(`Reference text; reply only "noted".\n\n${await filler(M.levels, 13000)}`);
      await pi.waitFor(() => pi.probe().some((r) => r.t === "compacted" || r.t === "compact_failed"), 600000).catch(() => undefined);
      const compacted = lastOf(pi, "compacted");
      check("pi compacted at its own point and modelctl wrote the summary", Boolean(compacted?.fromExtension), compacted ? `tokensBefore ${compacted.tokensBefore}` : JSON.stringify(pi.probe().filter((r) => r.t.includes("compact"))));
      await pi.prompt("What was the code word I asked you to remember? Reply with just the code word.");
      check("the conversation continues after the summary", /BLUE.?SEVEN/i.test(lastOf(pi, "assistant")?.text ?? ""), lastOf(pi, "assistant")?.text);
    });
  },

  // A small model (~20K) with its own reserve and keep-recent in pi's settings: no compaction early, one past the point.
  async small() {
    const key = `llama-swap/${M.small}`;
    await session({ piSettings: { compaction: { modelOverrides: { [key]: { reserveTokens: 4000, keepRecentTokens: 5000 } } } } }, async (pi) => {
      const model = ((await pi.send({ type: "get_available_models" })).data?.models ?? []).find((m) => `${m.provider}/${m.id}` === key);
      const point = (model?.contextWindow ?? 0) - 4000;
      await pi.send({ type: "set_model", provider: "llama-swap", modelId: M.small });
      await pi.send({ type: "set_thinking_level", level: "medium" });
      await pi.prompt(`Reference text follows; reply only "noted".\n\n${await filler(M.small, 5000)}`);
      check("no compaction at ~6K (pi's default reserve would compact at context - 16,384)", !pi.probe().some((r) => r.t === "compacted"), `${lastOf(pi, "request")?.usage?.tokens} tokens`);
      await pi.prompt(`More reference text; reply only "noted".\n\n${await filler(M.small, point - 6000)}`);
      await pi.waitFor(() => pi.probe().some((r) => r.t === "compacted" || r.t === "compact_failed"), 600000).catch(() => undefined);
      const compacted = lastOf(pi, "compacted");
      check(`compacted past ${point} (context - 4,000)`, Boolean(compacted) && compacted.tokensBefore >= point, compacted ? `tokensBefore ${compacted.tokensBefore}` : "no compaction");
      await pi.prompt("Reply with just the word: done.");
      check("it answers after the compaction", lastOf(pi, "assistant")?.stop === "stop", lastOf(pi, "assistant")?.text);
    });
  },
};

const ORDER = ["discovery", "budget", "summary", "small"];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ORDER;
for (const name of wanted) {
  console.log(`== ${name}`);
  try {
    await SCENARIOS[name]();
  } catch (e) {
    check(`${name} ran`, false, e.message);
  }
}
const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
