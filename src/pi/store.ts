// modelctl's folder in pi's agent directory (respects PI_CODING_AGENT_DIR): modelctl.json, private (mode 600: it can
// hold an API key), and the debug log when it's on. Also atomic JSON writes, and the HTTP helper the adapters use.
// Versions before 0.1.2 kept modelctl.json loose in pi's agent folder; it moves into the folder once.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { normalizeConfig, type Config, type Warnings } from "../core/config.ts";
import type { FetchJson } from "../adapters/types.ts";
import { log } from "./log.ts";
import { isRemoved } from "./removed.ts";

/** modelctl.json's permissions: only your user can read it. */
export const PRIVATE = 0o600;

/** modelctl's own folder: everything it writes, apart from the values it changes in pi's settings.json. */
export function dataDir(): string {
	return join(getAgentDir(), "pi-modelctl");
}

export function configPath(): string {
	return join(dataDir(), "modelctl.json");
}

/** Where versions before 0.1.2 kept it. */
export function oldConfigPath(): string {
	return join(getAgentDir(), "modelctl.json");
}

/**
 * modelctl.json from before 0.1.2 moves into modelctl's folder, once. If both exist, the one in the folder is used and
 * the old one is left for you to delete; the problem to show then.
 */
export function moveOldConfig(path = configPath(), old = oldConfigPath()): string | undefined {
	if (isRemoved() || !existsSync(old)) return undefined;
	if (existsSync(path)) return `${old} is from an older modelctl and isn't used (${path} is); delete it`;
	try {
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		renameSync(old, path);
		chmodSync(path, PRIVATE);
		log("files", `moved ${old} to ${path}`);
		return undefined;
	} catch (e) {
		return `couldn't move ${old} to ${path}: ${(e as Error).message}; it's still read from the old place next time`;
	}
}

/** The config, or the defaults when there is none. A file that can't be parsed is left untouched and reported. */
export function loadConfig(path = configPath()): { config: Config; warnings: Warnings; exists: boolean } {
	const warnings: Warnings = [];
	if (!existsSync(path)) return { config: normalizeConfig(undefined), warnings, exists: false };
	makePrivate(path);
	try {
		return { config: normalizeConfig(JSON.parse(readFileSync(path, "utf8")), warnings), warnings, exists: true };
	} catch (e) {
		warnings.push(`${path}: ${(e as Error).message}; using the defaults (the file is left as it is)`);
		return { config: normalizeConfig(undefined), warnings, exists: true };
	}
}

/** A modelctl.json others can read (from before it was always private) is made private. */
function makePrivate(path: string): void {
	try {
		if (!isRemoved() && (statSync(path).mode & 0o077) !== 0) chmodSync(path, PRIVATE);
	} catch {
		// Can't change it: reading still works.
	}
}

/**
 * Writes JSON through a temporary file and a rename, so a crash never leaves half a file. The file gets `mode`;
 * without one, an existing file keeps its own (pi's settings.json stays as pi made it) and a new one is private.
 * After "Remove everything" nothing is written.
 */
export function saveJson(path: string, value: unknown, mode?: number): void {
	if (isRemoved()) return;
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	let own: number | undefined;
	try {
		own = statSync(path).mode & 0o777;
	} catch {
		// A new file.
	}
	const tmp = `${path}.tmp-${process.pid}`;
	writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	chmodSync(tmp, mode ?? own ?? PRIVATE);
	renameSync(tmp, path);
	log("files", `wrote ${path}`);
}

/** fetch + JSON with a timeout. Throws on network errors, timeouts and non-2xx answers. */
export const fetchJson: FetchJson = async (url, init) => {
	const post = init?.body !== undefined;
	const started = Date.now();
	let res: Response;
	try {
		res = await fetch(url, {
			method: post ? "POST" : "GET",
			headers: { Accept: "application/json", ...(post ? { "Content-Type": "application/json" } : {}), ...init?.headers },
			...(post ? { body: JSON.stringify(init.body) } : {}),
			signal: AbortSignal.timeout(init?.timeoutMs ?? 2000),
		});
	} catch (e) {
		log("http", `${post ? "POST" : "GET"} ${url} failed after ${Date.now() - started} ms: ${(e as Error).message}`);
		throw e;
	}
	log("http", `${post ? "POST" : "GET"} ${url} → ${res.status} in ${Date.now() - started} ms`);
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	return res.json();
};
