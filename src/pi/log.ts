// The debug log, for finding out what went wrong: off unless PI_MODELCTL_DEBUG=1, then
// ~/.pi/agent/pi-modelctl/debug.log (in modelctl's own folder, so "Remove everything" deletes it). It records what
// modelctl does (servers asked and their answers, files written, pi settings changed, problems), never API keys.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isRemoved } from "./removed.ts";

let target: string | null | undefined;

function file(): string | null {
	if (target !== undefined) return target;
	target = process.env.PI_MODELCTL_DEBUG === "1" ? join(getAgentDir(), "pi-modelctl", "debug.log") : null;
	if (target) {
		try {
			mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
		} catch {
			target = null;
		}
	}
	return target;
}

/** One line in the debug log (when it's on). */
export function log(area: string, message: string): void {
	if (isRemoved()) return;
	const path = file();
	if (!path) return;
	try {
		appendFileSync(path, `${new Date().toISOString()} [${area}] ${message.replace(/\s*\n\s*/g, " ⏎ ")}\n`, { mode: 0o600 });
	} catch {
		// A log that can't be written must never break anything.
	}
}
