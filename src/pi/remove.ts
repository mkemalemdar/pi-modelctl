// "Remove everything" in the menu (or /modelctl remove), before uninstalling: modelctl.json (modelctl's only file) and
// its copies in npm's download cache, and when asked, the values of pi's own settings.json that the menu edits
// (thinking budgets, compaction reserve and keep-recent, also the per-model ones). Everything else in pi's settings
// is left as it is. Afterwards modelctl writes nothing more in this pi process.

import { readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanNpmCache } from "./cleanup/npm-cache.ts";
import { piSettingsPath, resetMenuValues } from "./pi-settings.ts";
import { isRemoved, markRemoved } from "./removed.ts";
import { configPath } from "./store.ts";

export const UNINSTALL_HINT = "To uninstall, quit pi and run `pi uninstall npm:pi-modelctl` (or the source `pi list` shows).";

/** This package's folder (where npm installed it). */
const packageRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** What "Remove everything" does, shown before it's confirmed. */
export const REMOVAL_DETAILS = [
	"This can't be undone. It deletes modelctl.json (your servers, hidden models, context sizes, thinking types and summary levels) and modelctl's copies in npm's download cache. pi then reloads, and your servers' models leave pi's list.",
	"",
	"Close any other pi windows that use modelctl first, so they can't write files again.",
].join("\n");

/** Deletes modelctl.json and half-written copies of it (never anything else in that folder). The report lines. */
export function removeConfigFiles(config = configPath()): string[] {
	const dir = dirname(config);
	const name = basename(config);
	let files: string[] = [];
	try {
		files = readdirSync(dir).filter((f) => f === name || f.startsWith(`${name}.tmp-`));
	} catch {
		// No agent folder: nothing to remove.
	}
	const problems: string[] = [];
	for (const f of files) {
		try {
			rmSync(join(dir, f), { force: true });
		} catch (e) {
			problems.push(`⚠ Couldn't remove ${join(dir, f)}: ${(e as Error).message}`);
		}
	}
	if (problems.length) return problems;
	return [files.includes(name) ? `✓ Deleted ${config}.` : `✓ ${config} wasn't there.`];
}

export interface RemoveOptions {
	config?: string;
	piSettings?: string;
	/** Cleans npm's cache; how many entries it removed. */
	npmCache?: () => Promise<number>;
}

/** Everything above, then modelctl stays inert; `resetPi` also resets pi's values the menu edits. The report lines. */
export async function removeEverything(resetPi: boolean, options: RemoveOptions = {}): Promise<string[]> {
	if (isRemoved()) return [`modelctl's files were already removed. ${UNINSTALL_HINT}`];
	const piSettings = options.piSettings ?? piSettingsPath();
	// The pi values first: after markRemoved nothing is written.
	const reset = resetPi ? resetMenuValues(piSettings) : undefined;
	markRemoved();
	const lines = removeConfigFiles(options.config);
	if (reset) {
		if ("error" in reset) lines.push(`⚠ pi's settings: ${reset.error}`);
		else lines.push(reset.removed ? `✓ Reset ${reset.removed} value${reset.removed === 1 ? "" : "s"} in ${piSettings} to pi's defaults.` : `✓ ${piSettings} had none of the menu's values.`);
	}
	try {
		const removed = await (options.npmCache ?? (() => cleanNpmCache(packageRoot())))();
		lines.push(removed > 0 ? `✓ Removed ${removed} cached download${removed === 1 ? "" : "s"} from npm's cache.` : "✓ Nothing of it in npm's cache.");
	} catch (e) {
		lines.push(`⚠ Couldn't clean npm's cache (${(e as Error).message}).`);
	}
	return lines;
}
