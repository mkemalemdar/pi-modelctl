// Status line: for one of our models, pi's own numbers in its footer: the context used, the thinking budget pi
// sends at the current level, and where pi compacts.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { statusLine } from "../core/format.ts";
import { compactionEnabled, compactionValue, thinkingBudget } from "../core/pisettings.ts";
import type { Runtime } from "./runtime.ts";

const KEY = "modelctl";

export function statusText(pi: ExtensionAPI, rt: Runtime, ctx: ExtensionContext): string | undefined {
	const entry = rt.entryFor(ctx.model);
	if (!entry?.def || !rt.config.statusLine) return undefined;
	const settings = pi.getSettings();
	const contextWindow = entry.def.contextWindow;
	const budgetSent = entry.def.reasoning && entry.adapter.budgetField !== undefined;
	return statusLine({
		used: ctx.getContextUsage()?.tokens,
		contextWindow,
		thinkingBudget: budgetSent ? thinkingBudget(settings, pi.getThinkingLevel()) : undefined,
		compactAt: compactionEnabled(settings) ? Math.max(0, contextWindow - compactionValue(settings, "reserveTokens", entry.key).value) : undefined,
	});
}

/** Registers the updates and returns the refresh, for the menu to call after a change. */
export function registerStatus(pi: ExtensionAPI, rt: Runtime): (ctx: ExtensionContext) => void {
	const update = (ctx: ExtensionContext) => {
		if (ctx.hasUI) ctx.ui.setStatus(KEY, statusText(pi, rt, ctx));
	};
	pi.on("session_start", (_e, ctx) => update(ctx));
	pi.on("model_select", (_e, ctx) => update(ctx));
	pi.on("thinking_level_select", (_e, ctx) => update(ctx));
	pi.on("turn_end", (_e, ctx) => update(ctx));
	pi.on("session_compact", (_e, ctx) => update(ctx));
	return update;
}
