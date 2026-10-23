// modelctl's own settings (modelctl.json): which servers to ask for models, and a few choices per model.
// Thinking budgets and compaction sizes are pi's own settings; modelctl edits them in pi's settings.json
// (see pisettings.ts) and keeps no copy here.
// Pure module: no pi imports, unit-tested in test/config.test.ts.

import { ENGINE_CATALOG, isEngineId, type EngineId } from "./engines.ts";
import { isPiLevel, thinkingFromSetting, type PiLevel } from "./levels.ts";

export const CONFIG_VERSION = 1;

/** The thinking level a compaction summary is written at. "current": the chat's own level, pi decides. */
export const SUMMARY_LEVELS = ["current", "lowest", "off", "low", "medium", "high"] as const;
export type SummaryLevel = (typeof SUMMARY_LEVELS)[number];

/** A provider name pi accepts: models appear as `<name>/<model>`. */
export const PROVIDER_NAME = /^[A-Za-z0-9._-]+$/;

export interface EngineRow {
  engine: EngineId;
  enabled: boolean;
  host: string;
  port: number;
  /** pi provider name, unique among the rows. */
  name: string;
  /** Sent as a Bearer token, exactly as typed. */
  apiKey?: string;
}

export interface ModelSettings {
  hidden?: boolean;
  /** The context the server runs the model with, when the server doesn't say. */
  contextWindow?: number;
  /** What thinking the model can do, when the server doesn't say (see thinkingFromSetting). */
  thinkingType?: unknown;
  /** The thinking level pi switches to when this model is selected. */
  levelOnSelect?: PiLevel;
  summaryLevel?: SummaryLevel;
}

export interface Config {
  version: number;
  engines: EngineRow[];
  discovery: { timeoutMs: number };
  /** For models without their own. */
  summaryLevel: SummaryLevel;
  statusLine: boolean;
  /** Keyed by `provider/model`. */
  models: Record<string, ModelSettings>;
}

/** Problems found while reading a config; the value in question is ignored. */
export type Warnings = string[];

export function defaultConfig(): Config {
  return {
    version: CONFIG_VERSION,
    engines: ENGINE_CATALOG.map((e) => ({ engine: e.id, enabled: false, host: "127.0.0.1", port: e.defaultPort, name: e.id })),
    discovery: { timeoutMs: 2000 },
    summaryLevel: "current",
    statusLine: true,
    models: {},
  };
}

/** Turns any parsed JSON into a valid Config. Unknown keys are dropped; invalid values are reported and ignored. */
export function normalizeConfig(raw: unknown, warnings: Warnings = []): Config {
  const cfg = defaultConfig();
  if (!isObject(raw)) return cfg;
  if (Array.isArray(raw.engines)) cfg.engines = normalizeEngines(raw.engines, warnings);
  if (isObject(raw.discovery)) cfg.discovery.timeoutMs = int(raw.discovery.timeoutMs, 100, 60_000, "discovery.timeoutMs", warnings) ?? cfg.discovery.timeoutMs;
  if (raw.summaryLevel !== undefined) cfg.summaryLevel = summaryLevel(raw.summaryLevel, "summaryLevel", warnings) ?? cfg.summaryLevel;
  if (typeof raw.statusLine === "boolean") cfg.statusLine = raw.statusLine;
  if (isObject(raw.models)) {
    for (const [key, value] of Object.entries(raw.models)) {
      if (!key.includes("/")) warnings.push(`models["${key}"]: the key must be provider/model; ignored`);
      else if (isObject(value)) cfg.models[key] = normalizeModel(value, `models["${key}"]`, warnings);
    }
  }
  return cfg;
}

function normalizeEngines(rows: unknown[], warnings: Warnings): EngineRow[] {
  const out: EngineRow[] = [];
  rows.forEach((row, i) => {
    if (!isObject(row) || !isEngineId(row.engine)) {
      warnings.push(`engines[${i}]: unknown engine; ignored`);
      return;
    }
    const def = ENGINE_CATALOG.find((e) => e.id === row.engine)!;
    let name = typeof row.name === "string" && PROVIDER_NAME.test(row.name) ? row.name : def.id;
    // Model settings are keyed by provider name: two rows with one name would share them.
    if (out.some((r) => r.name === name)) {
      const unique = freeName(out, name);
      warnings.push(`engines[${i}]: the name "${name}" is already used; renamed to "${unique}"`);
      name = unique;
    }
    out.push({
      engine: row.engine,
      enabled: row.enabled === true,
      host: typeof row.host === "string" && row.host.trim() ? row.host.trim() : "127.0.0.1",
      port: int(row.port, 1, 65535, `engines[${i}].port`, warnings) ?? def.defaultPort,
      name,
      ...(typeof row.apiKey === "string" && row.apiKey ? { apiKey: row.apiKey } : {}),
    });
  });
  // Kinds missing from the file still show on the Servers page, switched off.
  for (const def of ENGINE_CATALOG) {
    if (!out.some((r) => r.engine === def.id)) out.push({ engine: def.id, enabled: false, host: "127.0.0.1", port: def.defaultPort, name: freeName(out, def.id) });
  }
  return out;
}

function normalizeModel(raw: Record<string, unknown>, path: string, warnings: Warnings): ModelSettings {
  const m: ModelSettings = {};
  if (typeof raw.hidden === "boolean") m.hidden = raw.hidden;
  const cw = int(raw.contextWindow, 256, 100_000_000, `${path}.contextWindow`, warnings);
  if (cw !== undefined) m.contextWindow = cw;
  if (raw.thinkingType !== undefined) {
    if (thinkingFromSetting(raw.thinkingType)) m.thinkingType = raw.thinkingType;
    else warnings.push(`${path}.thinkingType: expected {"kind": "none" | "onoff" | "levels", ...}; ignored`);
  }
  if (raw.levelOnSelect !== undefined) {
    if (isPiLevel(raw.levelOnSelect)) m.levelOnSelect = raw.levelOnSelect;
    else warnings.push(`${path}.levelOnSelect: not a pi thinking level; ignored`);
  }
  if (raw.summaryLevel !== undefined) {
    const level = summaryLevel(raw.summaryLevel, `${path}.summaryLevel`, warnings);
    if (level) m.summaryLevel = level;
  }
  return m;
}

/** The summary level a model uses: its own, else the one for all models. */
export function summaryLevelFor(cfg: Config, modelKey: string): SummaryLevel {
  return cfg.models[modelKey]?.summaryLevel ?? cfg.summaryLevel;
}

/** A provider name no server row uses yet: `base`, else `base-2`, `base-3`, ... */
export function freeProviderName(cfg: Config, base: string): string {
  return freeName(cfg.engines, base);
}

function freeName(rows: readonly EngineRow[], base: string): string {
  const used = new Set(rows.map((r) => r.name));
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** Switched-on rows pointing at the same host:port (a warning: usually a mistake). */
export function duplicateEndpoints(cfg: Config): string[] {
  const seen = new Map<string, string>();
  const dups: string[] = [];
  for (const r of cfg.engines.filter((x) => x.enabled)) {
    const endpoint = `${r.host}:${r.port}`;
    const previous = seen.get(endpoint);
    if (previous) dups.push(`${previous} and ${r.name} both point at ${endpoint}`);
    else seen.set(endpoint, r.name);
  }
  return dups;
}

/** Sets or (with undefined) removes one of a model's settings; a model left without settings is dropped. */
export function setModelSetting<K extends keyof ModelSettings>(cfg: Config, modelKey: string, key: K, value: ModelSettings[K] | undefined): void {
  const m = (cfg.models[modelKey] ??= {});
  if (value === undefined) delete m[key];
  else m[key] = value;
  if (Object.keys(m).length === 0) delete cfg.models[modelKey];
}

/** Moves every model's settings from one provider name to another (a server was renamed). */
export function renameProvider(cfg: Config, from: string, to: string): void {
  for (const key of Object.keys(cfg.models)) {
    if (!key.startsWith(`${from}/`)) continue;
    cfg.models[`${to}/${key.slice(from.length + 1)}`] = cfg.models[key];
    delete cfg.models[key];
  }
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function summaryLevel(v: unknown, path: string, warnings: Warnings): SummaryLevel | undefined {
  if ((SUMMARY_LEVELS as readonly unknown[]).includes(v)) return v as SummaryLevel;
  warnings.push(`${path}: expected one of ${SUMMARY_LEVELS.join(", ")}; ignored`);
  return undefined;
}

function int(v: unknown, min: number, max: number, path: string, warnings: Warnings): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    warnings.push(`${path}: expected a whole number from ${min} to ${max}; ignored`);
    return undefined;
  }
  return v;
}
