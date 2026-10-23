// Minimal pi RPC driver for integration tests. Starts pi with pi-modelctl + the probe extension and
// talks JSON lines over stdio. Uses the dev pi (PI_DEV/env) and its isolated config dir.

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";

const ROOT = new URL("../../", import.meta.url).pathname;

export class Pi {
  /** cwd: where pi runs (and where the model's tools act). Tests pass a scratch folder. */
  constructor({ probeLog, extraArgs = [], env = {}, cwd } = {}) {
    this.probeLog = probeLog;
    this.events = [];
    this.waiters = [];
    this.pending = new Map();
    this.seq = 0;
    this.started = Date.now();
    this.proc = spawn(
      "pi",
      ["--mode", "rpc", "--no-session", "--extension", `${ROOT}src/index.ts`, "--extension", `${ROOT}test/integration/probe.ts`, ...extraArgs],
      { cwd: cwd ?? ROOT, env: { ...process.env, MODELCTL_PROBE_LOG: probeLog, ...env }, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.stderr = "";
    this.proc.stderr.on("data", (d) => (this.stderr += d.toString()));
    createInterface({ input: this.proc.stdout }).on("line", (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.type === "response" && msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
        return;
      }
      if (msg.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(msg.method)) {
        this.send({ type: "extension_ui_response", id: msg.id, cancelled: true }, false);
      }
      this.events.push(msg);
      for (const w of [...this.waiters]) if (w.pred(msg)) w.resolve(msg);
    });
  }

  send(cmd, expectResponse = true) {
    const id = `t${++this.seq}`;
    const body = expectResponse ? { id, ...cmd } : cmd;
    this.proc.stdin.write(`${JSON.stringify(body)}\n`);
    if (!expectResponse) return Promise.resolve(undefined);
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  waitFor(pred, timeoutMs = 600000) {
    const hit = this.events.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve: (m) => (clearTimeout(timer), this.waiters.splice(this.waiters.indexOf(w), 1), resolve(m)) };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        reject(new Error(`timeout waiting (${timeoutMs} ms)`));
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  /** Sends a prompt and waits until pi settles (no retry/compaction/follow-up pending). */
  async prompt(message, timeoutMs = 900000) {
    const mark = this.events.length;
    const res = await this.send({ type: "prompt", message });
    if (!res.success) throw new Error(`prompt failed: ${JSON.stringify(res)}`);
    if (res.data?.disposition === "handled") return res;
    await this.waitFor((m) => m.type === "agent_settled" && this.events.indexOf(m) >= mark, timeoutMs);
    return res;
  }

  notifications() {
    return this.events.filter((e) => e.type === "extension_ui_request" && e.method === "notify").map((e) => `${e.notifyType ?? "info"}: ${e.message}`);
  }

  statuses() {
    return this.events.filter((e) => e.type === "extension_ui_request" && e.method === "setStatus" && e.statusKey === "modelctl").map((e) => e.statusText);
  }

  probe() {
    if (!existsSync(this.probeLog)) return [];
    return readFileSync(this.probeLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  }

  async close() {
    this.proc.stdin.end();
    await new Promise((r) => {
      const t = setTimeout(() => (this.proc.kill("SIGTERM"), r()), 5000);
      this.proc.on("exit", () => (clearTimeout(t), r()));
    });
  }
}
