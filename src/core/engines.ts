// The kinds of inference server the Servers page offers. A new kind = one entry here + an adapter.
// Pure module: no pi imports.

export type EngineId = "llama-swap" | "llama-server" | "strata" | "ollama" | "vllm" | "sglang" | "openai";
export type AdapterId = "llama-swap" | "llama-server" | "strata" | "ollama" | "vllm" | "openai";

export interface EngineInfo {
	id: EngineId;
	label: string;
	defaultPort: number;
	/** Which adapter reads it; kinds without their own use the generic OpenAI one. */
	adapter: AdapterId;
}

export const ENGINE_CATALOG: readonly EngineInfo[] = [
	{ id: "llama-swap", label: "llama-swap", defaultPort: 8080, adapter: "llama-swap" },
	{ id: "llama-server", label: "llama.cpp (llama-server)", defaultPort: 8080, adapter: "llama-server" },
	{ id: "strata", label: "Strata", defaultPort: 8080, adapter: "strata" },
	{ id: "ollama", label: "Ollama", defaultPort: 11434, adapter: "ollama" },
	{ id: "vllm", label: "vLLM", defaultPort: 8000, adapter: "vllm" },
	{ id: "sglang", label: "SGLang", defaultPort: 30000, adapter: "openai" },
	{ id: "openai", label: "Other OpenAI-compatible", defaultPort: 8000, adapter: "openai" },
];

export function isEngineId(value: unknown): value is EngineId {
	return typeof value === "string" && ENGINE_CATALOG.some((e) => e.id === value);
}

export function engineInfo(id: EngineId): EngineInfo {
	const info = ENGINE_CATALOG.find((e) => e.id === id);
	if (!info) throw new Error(`unknown engine "${id}"`);
	return info;
}
