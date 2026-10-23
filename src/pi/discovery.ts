// Discovery -> pi providers: one provider per switched-on server, its models appear as `provider/model`.
// A model whose context isn't known stays out of pi until the server reports it or it's set on the model's page.

import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { duplicateEndpoints, type EngineRow } from "../core/config.ts";
import { askServer, modelEntries, originOf, piLiteral, type ModelEntry, type ServerAnswer } from "../core/discover.ts";
import { fetchJson } from "./store.ts";
import type { Runtime } from "./runtime.ts";

/** pi needs some key to list a provider's models; servers without auth ignore it. */
const NO_KEY = "modelctl-no-key";

export interface DiscoveryReport {
  servers: { name: string; origin: string; models: number; error?: string }[];
  warnings: string[];
}

/** The models pi gets from a server: known context, not hidden. */
export function offered(entries: Iterable<ModelEntry>): ModelEntry[] {
  return [...entries].filter((e) => e.def !== undefined && !e.hidden);
}

/** Asks every switched-on server in parallel and (re)registers its provider; a switched-off one goes away. */
export async function runDiscovery(pi: ExtensionAPI, rt: Runtime): Promise<DiscoveryReport> {
  const rows = rt.config.engines.filter((r) => r.enabled);
  const answers = await Promise.all(rows.map((row) => askServer(row, fetchJson, rt.config.discovery.timeoutMs)));
  const catalog = new Map<string, ModelEntry>();
  const errors = new Map<string, string>();
  const registered = new Set<string>();

  for (const answer of answers) {
    if (answer.error) errors.set(answer.row.name, answer.error);
    const entries = modelEntries(answer, rt.config);
    for (const e of entries) catalog.set(e.key, e);
    if (offered(entries).length === 0) continue;
    register(pi, rt, answer.row, entries);
    registered.add(answer.row.name);
  }
  for (const name of rt.providers) if (!registered.has(name)) pi.unregisterProvider(name);
  rt.catalog = catalog;
  rt.errors = errors;
  rt.providers = registered;
  return { servers: answers.map(report), warnings: duplicateEndpoints(rt.config) };
}

function report(a: ServerAnswer): DiscoveryReport["servers"][number] {
  return { name: a.row.name, origin: a.origin, models: a.models.length, ...(a.error ? { error: a.error } : {}) };
}

function register(pi: ExtensionAPI, rt: Runtime, row: EngineRow, entries: ModelEntry[]): void {
  const defs = (list: ModelEntry[]) => offered(list).map((e) => e.def) as unknown as ProviderModelConfig[];
  pi.registerProvider(row.name, {
    name: row.name,
    baseUrl: `${originOf(row)}/v1`,
    api: "openai-completions",
    apiKey: row.apiKey ? piLiteral(row.apiKey) : NO_KEY,
    authHeader: Boolean(row.apiKey),
    models: defs(entries),
    // pi asks for a fresh list (e.g. when /model opens): ask this server again.
    refreshModels: async () => {
      const answer = await askServer(row, fetchJson, rt.config.discovery.timeoutMs);
      if (answer.error) rt.errors.set(row.name, answer.error);
      else rt.errors.delete(row.name);
      const fresh = modelEntries(answer, rt.config);
      for (const key of [...rt.catalog.keys()]) if (key.startsWith(`${row.name}/`)) rt.catalog.delete(key);
      for (const e of fresh) rt.catalog.set(e.key, e);
      return defs(fresh);
    },
  });
}
