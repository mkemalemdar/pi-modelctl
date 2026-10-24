// /modelctl          the menu (src/pi/ui/panel.ts)
// /modelctl show     the servers and the values the current model uses, as text
// /modelctl reload   pi's /reload: pi reads its settings again and modelctl asks the servers again
// /modelctl remove   Remove everything (before uninstalling), without the menu

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { summaryLevelFor } from "../core/config.ts";
import { fmtExact } from "../core/format.ts";
import { SUMMARY_LEVEL_TEXT, thinkingText } from "../core/labels.ts";
import { compactionValue, thinkingBudget } from "../core/pisettings.ts";
import type { DiscoveryReport } from "./discovery.ts";
import { readPiSettings, writePiSetting } from "./pi-settings.ts";
import { REMOVAL_DETAILS, removeEverything, UNINSTALL_HINT } from "./remove.ts";
import { isRemoved } from "./removed.ts";
import { configPath, PRIVATE, saveJson } from "./store.ts";
import { showPanel } from "./ui/panel.ts";
import type { Runtime } from "./runtime.ts";

export interface CommandDeps {
	rediscover: () => Promise<DiscoveryReport>;
	refreshStatus: (ctx: ExtensionContext) => void;
}

export function registerCommand(pi: ExtensionAPI, rt: Runtime, deps: CommandDeps): void {
	pi.registerCommand("modelctl", {
		description: "Your self-hosted models: servers, thinking budgets, compaction. /modelctl remove: remove everything before uninstalling",
		getArgumentCompletions: (prefix) => {
			const items = ["show", "reload", "remove"].filter((s) => s.startsWith(prefix.trim())).map((s) => ({ value: s, label: s }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const sub = args.trim();
			if (sub === "show") return say(ctx, showText(pi, rt, ctx));
			if (sub === "reload") return ctx.reload();
			if (sub && sub !== "remove") return say(ctx, `Unknown subcommand "${sub}". Use /modelctl, /modelctl show, /modelctl reload or /modelctl remove.`, "warning");
			if (isRemoved()) return say(ctx, `modelctl's files were removed. ${UNINSTALL_HINT}`);
			// The same as the menu's Remove everything, without the menu (e.g. for an AI agent over RPC).
			if (sub === "remove") {
				if (!(await ctx.ui.confirm("Remove everything?", REMOVAL_DETAILS))) return;
				const resetPi = await ctx.ui.confirm(
					"Also reset pi's values set in modelctl's menu?",
					"Removes thinkingBudgets and compaction reserveTokens / keepRecentTokens (also per model) from pi's settings.json, so pi uses its defaults. Everything else in that file stays.",
				);
				return remove(ctx, resetPi);
			}
			if (!ctx.hasUI || ctx.mode !== "tui") return say(ctx, `${showText(pi, rt, ctx)}\n\nThe menu needs pi's terminal UI.`);
			await openPanel(ctx);
		},
	});

	async function openPanel(ctx: ExtensionCommandContext): Promise<void> {
		const result = await showPanel(ctx, {
			pi,
			rt,
			save: () => {
				try {
					saveJson(configPath(), rt.config, PRIVATE);
					return undefined;
				} catch (e) {
					return `could not save ${configPath()}: ${(e as Error).message}`;
				}
			},
			rediscover: deps.rediscover,
			refreshStatus: () => deps.refreshStatus(ctx),
			piSettings: { read: () => readPiSettings(), write: (path, value) => writePiSetting(path, value) },
		});
		if (result === "reload") await ctx.reload();
		else if (result?.remove) await remove(ctx, result.resetPi);
	}

	async function remove(ctx: ExtensionCommandContext, resetPi: boolean): Promise<void> {
		const lines = await removeEverything(resetPi);
		say(ctx, `modelctl removed.\n${lines.join("\n")}\n${UNINSTALL_HINT}`, lines.some((l) => l.startsWith("⚠")) ? "warning" : "info");
		// modelctl starts again with nothing set, so nothing of the old settings stays in pi.
		await ctx.reload();
	}
}

/** The servers, and the values the current model uses with where each comes from. */
export function showText(pi: ExtensionAPI, rt: Runtime, ctx: ExtensionContext): string {
	const lines: string[] = [];
	const on = rt.config.engines.filter((r) => r.enabled);
	if (on.length === 0) lines.push("No server is switched on. Open /modelctl → Servers.");
	for (const r of on) {
		const error = rt.errors.get(r.name);
		const models = [...rt.catalog.values()].filter((e) => e.provider === r.name);
		lines.push(error ? `${r.name} (${r.host}:${r.port}) isn't answering: ${error}` : `${r.name} (${r.host}:${r.port}): ${models.length} models`);
		for (const e of models.filter((m) => !m.def)) lines.push(`  ${e.model.id}: context unknown, not in pi (set it on the model's page)`);
	}
	const e = rt.entryFor(ctx.model);
	if (ctx.model && !e) lines.push("", `${ctx.model.provider}/${ctx.model.id} isn't from one of your servers.`);
	if (e?.def) {
		const settings = pi.getSettings();
		const reserve = compactionValue(settings, "reserveTokens", e.key);
		const keep = compactionValue(settings, "keepRecentTokens", e.key);
		const budget = e.def.reasoning && e.adapter.budgetField ? thinkingBudget(settings, pi.getThinkingLevel()) : undefined;
		lines.push(
			"",
			e.key,
			`  context        ${fmtExact(e.def.contextWindow)}${rt.config.models[e.key]?.contextWindow ? " (set by you)" : ""}`,
			`  input          ${e.def.input.join(" + ")}`,
			`  thinking       ${thinkingText(e.thinking)}`,
			`  budget         ${budget === undefined ? "none sent" : `${fmtExact(budget)} at ${pi.getThinkingLevel()} (${e.adapter.budgetField})`}`,
			`  summary level  ${SUMMARY_LEVEL_TEXT[summaryLevelFor(rt.config, e.key)]}`,
			`  reserve        ${fmtExact(reserve.value)} (${reserve.source})`,
			`  keep recent    ${fmtExact(keep.value)} (${keep.source})`,
		);
	}
	const piFile = readPiSettings();
	if ("error" in piFile) lines.push("", `pi's settings: ${piFile.error}`);
	if (rt.warnings.length) lines.push("", "Problems in modelctl.json (those values were ignored):", ...rt.warnings.map((w) => `  ${w}`));
	return lines.join("\n");
}

function say(ctx: ExtensionContext, text: string, level: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) ctx.ui.notify(text, level);
	else console.log(text);
}
