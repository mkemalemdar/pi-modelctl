// Adapter registry. A new kind of server = an adapter file + one line here + an entry in core/engines.ts.

import { engineInfo, type AdapterId, type EngineId } from "../core/engines.ts";
import { llamaServerAdapter } from "./llama-server.ts";
import { llamaSwapAdapter } from "./llama-swap.ts";
import { ollamaAdapter } from "./ollama.ts";
import { openaiAdapter } from "./openai.ts";
import { strataAdapter } from "./strata.ts";
import { vllmAdapter } from "./vllm.ts";
import type { EngineAdapter } from "./types.ts";

const ADAPTERS: Record<AdapterId, EngineAdapter> = {
  "llama-swap": llamaSwapAdapter,
  "llama-server": llamaServerAdapter,
  strata: strataAdapter,
  ollama: ollamaAdapter,
  vllm: vllmAdapter,
  openai: openaiAdapter,
};

export function adapterFor(engine: EngineId): EngineAdapter {
  return ADAPTERS[engineInfo(engine).adapter];
}

export type { DiscoveredModel, EngineAdapter, FetchJson } from "./types.ts";
