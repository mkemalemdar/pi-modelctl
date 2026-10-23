// Discovery: ask one server for its models and turn them into entries for pi.
// Pure module (HTTP injected), unit-tested in test/discover.test.ts.

import { adapterFor } from "../adapters/index.ts";
import type { DiscoveredModel, EngineAdapter, FetchJson } from "../adapters/types.ts";
import type { Config, EngineRow } from "./config.ts";
import type { ThinkingSpec } from "./levels.ts";
import { buildModelDef, resolveContextWindow, resolveThinking, type PiModelDef } from "./modelconfig.ts";

export interface ModelEntry {
  /** `provider/model` */
  key: string;
  provider: string;
  row: EngineRow;
  adapter: EngineAdapter;
  model: DiscoveredModel;
  thinking: ThinkingSpec;
  /** The context it runs with; undefined when neither the server nor a setting says. */
  contextWindow?: number;
  /** pi's definition; undefined while the context is unknown, so the model stays out of pi. */
  def?: PiModelDef;
  hidden: boolean;
}

export interface ServerAnswer {
  row: EngineRow;
  origin: string;
  models: DiscoveredModel[];
  /** Why the server gave no models (not answering, refused, ...). */
  error?: string;
}

export function originOf(row: EngineRow): string {
  const host = row.host.includes(":") && !row.host.startsWith("[") ? `[${row.host}]` : row.host;
  return `http://${host}:${row.port}`;
}

/** The header a server with an API key expects. */
export function authHeaders(row: EngineRow): Record<string, string> | undefined {
  return row.apiKey ? { Authorization: `Bearer ${row.apiKey}` } : undefined;
}

/**
 * A key as pi should take it, exactly as typed: pi reads "$NAME" as an environment variable and "!cmd" as a command,
 * so "$" is written "$$" and a leading "!" as "$!" (pi's escapes).
 */
export function piLiteral(value: string): string {
  const escaped = value.replace(/\$/g, "$$$$");
  return escaped.startsWith("!") ? `$${escaped}` : escaped;
}

/** Asks one server for its models. Never throws: a server that doesn't answer gives no models and an error. */
export async function askServer(row: EngineRow, fetchJson: FetchJson, timeoutMs: number): Promise<ServerAnswer> {
  const origin = originOf(row);
  try {
    const models = await adapterFor(row.engine).discover({ origin, fetchJson, timeoutMs, headers: authHeaders(row) });
    return { row, origin, models };
  } catch (e) {
    return { row, origin, models: [], error: (e as Error).message || String(e) };
  }
}

/** One entry per model, with its settings applied. */
export function modelEntries(answer: ServerAnswer, cfg: Config): ModelEntry[] {
  const adapter = adapterFor(answer.row.engine);
  return answer.models.map((model) => {
    const key = `${answer.row.name}/${model.id}`;
    const settings = cfg.models[key];
    const thinking = resolveThinking(model, settings, adapter);
    const contextWindow = resolveContextWindow(model, settings);
    return {
      key,
      provider: answer.row.name,
      row: answer.row,
      adapter,
      model,
      thinking,
      contextWindow,
      def: contextWindow === undefined ? undefined : buildModelDef(model, thinking, contextWindow, adapter),
      hidden: settings?.hidden === true,
    };
  });
}
