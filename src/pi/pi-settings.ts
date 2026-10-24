// Reading and changing values in pi's own settings.json (~/.pi/agent/settings.json). pi reads the file at startup
// and on /reload, and merges its own later writes into what's on disk, so a value written here stays.
// What can be changed, and pi's defaults: src/core/pisettings.ts.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isObject } from "../core/config.ts";
import { menuValuePaths, writePath, type SettingPath } from "../core/pisettings.ts";
import { saveJson } from "./store.ts";

export function piSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

/** The settings in the file (what applies after the next /reload), or why they couldn't be read. */
export function readPiSettings(path = piSettingsPath()): { settings: Record<string, unknown> } | { error: string } {
	if (!existsSync(path)) return { settings: {} };
	try {
		const raw = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
		return isObject(raw) ? { settings: raw } : { error: `${path} doesn't hold a JSON object` };
	} catch (e) {
		return { error: `could not read ${path}: ${(e as Error).message}` };
	}
}

/**
 * Sets one value (undefined: removes it, back to pi's default) and keeps everything else in the file. A file that
 * can't be read is never overwritten. Returns a problem to show, or undefined.
 */
export function writePiSetting(path: SettingPath, value: number | undefined, file = piSettingsPath()): string | undefined {
	const current = readPiSettings(file);
	if ("error" in current) return `${current.error}; nothing was changed`;
	try {
		saveJson(file, writePath(current.settings, path, value));
		return undefined;
	} catch (e) {
		return `could not write ${file}: ${(e as Error).message}`;
	}
}

/**
 * Removes every value the modelctl menu edits (back to pi's defaults) and keeps everything else in the file. Returns
 * how many were removed, or the problem (a file that can't be read is never overwritten).
 */
export function resetMenuValues(file = piSettingsPath()): { removed: number } | { error: string } {
	const current = readPiSettings(file);
	if ("error" in current) return { error: `${current.error}; nothing was changed` };
	const paths = menuValuePaths(current.settings);
	if (paths.length === 0) return { removed: 0 };
	try {
		saveJson(file, paths.reduce((settings, path) => writePath(settings, path, undefined), current.settings));
		return { removed: paths.length };
	} catch (e) {
		return { error: `could not write ${file}: ${(e as Error).message}` };
	}
}
