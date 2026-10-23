// modelctl.json in pi's agent directory (respects PI_CODING_AGENT_DIR), atomic JSON writes, and the HTTP helper
// the adapters use.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { normalizeConfig, type Config, type Warnings } from "../core/config.ts";
import type { FetchJson } from "../adapters/types.ts";

export function configPath(): string {
  return join(getAgentDir(), "modelctl.json");
}

/** The config, or the defaults when there is none. A file that can't be parsed is left untouched and reported. */
export function loadConfig(path = configPath()): { config: Config; warnings: Warnings; exists: boolean } {
  const warnings: Warnings = [];
  if (!existsSync(path)) return { config: normalizeConfig(undefined), warnings, exists: false };
  try {
    return { config: normalizeConfig(JSON.parse(readFileSync(path, "utf8")), warnings), warnings, exists: true };
  } catch (e) {
    warnings.push(`${path}: ${(e as Error).message}; using the defaults (the file is left as it is)`);
    return { config: normalizeConfig(undefined), warnings, exists: true };
  }
}

/** Writes JSON through a temporary file and a rename, so a crash never leaves half a file. */
export function saveJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

/** fetch + JSON with a timeout. Throws on network errors, timeouts and non-2xx answers. */
export const fetchJson: FetchJson = async (url, init) => {
  const post = init?.body !== undefined;
  const res = await fetch(url, {
    method: post ? "POST" : "GET",
    headers: { Accept: "application/json", ...(post ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    ...(post ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(init?.timeoutMs ?? 2000),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
};
