// Summary thinking level: when pi compacts a model that has a summary level set (its own, or the one for all
// models), the summary is written at that level by pi's own compact(), the technique pi-compaction-model (MIT)
// uses. When and how much pi compacts, its prompts and cut points stay pi's. Models left at "current" (the
// default) aren't touched. The compaction record notes the level (details.summaryLevel), and the debug log says
// for every compaction who wrote the summary at which level.

import { compact, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { summaryLevelFor } from "../core/config.ts";
import { compactionLevel } from "../core/compaction.ts";
import { log } from "./log.ts";
import type { Runtime } from "./runtime.ts";

export function registerSummaryLevel(pi: ExtensionAPI, rt: Runtime): void {
	pi.on("session_before_compact", async (event, ctx) => {
		const entry = rt.entryFor(ctx.model);
		if (!entry || !ctx.model) return undefined;
		const level = compactionLevel(entry.thinking, summaryLevelFor(rt.config, entry.key), pi.getThinkingLevel());
		if (!level) {
			log("compaction", `${entry.key}: summary left to pi, at the chat's level ${pi.getThinkingLevel()}`);
			return undefined;
		}
		try {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
			if (!auth.ok) return undefined;
			carryFileLists(event.preparation, event.branchEntries);
			const result = await compact(event.preparation, ctx.model, auth.apiKey, stringHeaders(auth.headers), event.customInstructions, event.signal, level, undefined, auth.env);
			log("compaction", `${entry.key}: summary written by modelctl at ${level} (the chat is at ${pi.getThinkingLevel()}), ${result.summary.length} characters`);
			return { compaction: { ...result, details: { ...(result.details as object | undefined), summaryLevel: level } } };
		} catch (e) {
			// pi then writes the summary itself, at the chat's level.
			log("compaction", `${entry.key}: the summary at ${level} failed (${(e as Error).message}); pi writes it at ${pi.getThinkingLevel()}`);
			if (!event.signal.aborted && ctx.hasUI) ctx.ui.notify(`modelctl: the summary at level ${level} failed (${(e as Error).message}); pi writes it at the current level`, "warning");
			return undefined;
		}
	});
}

/**
 * pi lists the files read and edited in each summary and carries the lists into the next one, but not from a
 * summary an extension wrote. Ours is in pi's own format: put its lists back so the next summary keeps them.
 */
function carryFileLists(preparation: { fileOps: { read: Set<string>; edited: Set<string> } }, branchEntries: { type: string; details?: unknown }[]): void {
	const previous = [...branchEntries].reverse().find((e) => e.type === "compaction");
	const details = previous?.details as { readFiles?: unknown; modifiedFiles?: unknown } | undefined;
	for (const f of Array.isArray(details?.readFiles) ? details.readFiles : []) if (typeof f === "string") preparation.fileOps.read.add(f);
	for (const f of Array.isArray(details?.modifiedFiles) ? details.modifiedFiles : []) if (typeof f === "string") preparation.fileOps.edited.add(f);
}

/** pi's headers allow null (= remove); compact() takes plain strings. */
function stringHeaders(headers: Record<string, string | null> | undefined): Record<string, string> | undefined {
	if (!headers) return undefined;
	return Object.fromEntries(Object.entries(headers).filter((kv): kv is [string, string] => typeof kv[1] === "string"));
}
