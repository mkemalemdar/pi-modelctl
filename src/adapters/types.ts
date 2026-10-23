// The adapter contract. An adapter knows one kind of server: how to list its models, what it reports about
// them, and how the server switches and caps thinking. Adapters never import pi.

import type { AdapterId } from "../core/engines.ts";
import type { ThinkingSpec } from "../core/levels.ts";

/** A model as the server describes it. */
export interface DiscoveredModel {
  id: string;
  /** The context the server runs it with; undefined when the server doesn't say. */
  contextWindow?: number;
  input: ("text" | "image")[];
  thinking: ThinkingSpec;
  /** The server's suggested max output (llama-swap `metadata.output_length`). */
  maxTokensHint?: number;
}

export interface FetchJson {
  /** GET by default; with `body`, a JSON POST. Throws on network errors, timeouts and non-2xx answers. */
  (url: string, init?: { timeoutMs?: number; headers?: Record<string, string>; body?: unknown }): Promise<unknown>;
}

export interface DiscoverOptions {
  /** e.g. http://127.0.0.1:8080 (no trailing slash, no /v1). */
  origin: string;
  fetchJson: FetchJson;
  timeoutMs: number;
  headers?: Record<string, string>;
}

export interface EngineAdapter {
  id: AdapterId;
  /** Lists the server's chat models. Must never make the server load a model. */
  discover(opts: DiscoverOptions): Promise<DiscoveredModel[]>;
  /**
   * How the server switches thinking:
   * - chat-template:    `chat_template_kwargs` (enable_thinking, reasoning_effort), read by the model's template
   * - reasoning-effort: the OpenAI field `reasoning_effort`, mapped by the server
   * - none:             no switch
   */
  thinkingWire: "chat-template" | "reasoning-effort" | "none";
  /** reasoning-effort servers: the word for "off". */
  offEffort?: string;
  /** The request field that caps thinking; pi fills it with its budget for the level. Undefined: none. */
  budgetField?: string;
}

/** Reads `.data` of an OpenAI-style list, or [] when the shape is wrong. */
export function listData(body: unknown): Record<string, unknown>[] {
  const data = (body as { data?: unknown })?.data;
  return Array.isArray(data) ? data.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
}

export function positiveInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
}

/** Image input from `architecture.input_modalities` or `capabilities.vision`. */
export function inputModalities(m: Record<string, unknown>): ("text" | "image")[] {
  const arch = m.architecture as { input_modalities?: unknown } | undefined;
  const caps = m.capabilities as { vision?: unknown } | undefined;
  const mods = Array.isArray(arch?.input_modalities) ? arch.input_modalities : [];
  return mods.includes("image") || caps?.vision === true ? ["text", "image"] : ["text"];
}
