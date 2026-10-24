// pi-modelctl: a helper for self-hosted models in pi. Wiring only; each part lives in its own module.
//
//   src/core/      pure logic (settings, discovery, thinking levels, pi's settings file), unit-tested
//   src/adapters/  one file per kind of server
//   src/pi/        pi glue: discovery, summary level, level on select, status line, the /modelctl command

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommand } from "./pi/command.ts";
import { registerSummaryLevel } from "./pi/compaction.ts";
import { runDiscovery } from "./pi/discovery.ts";
import { Runtime } from "./pi/runtime.ts";
import { registerLevelOnSelect } from "./pi/select-level.ts";
import { registerStatus } from "./pi/status.ts";
import { loadConfig, moveOldConfig } from "./pi/store.ts";

export default async function modelctl(pi: ExtensionAPI): Promise<void> {
	// Before 0.1.2 modelctl.json lived loose in pi's agent folder.
	const moveProblem = moveOldConfig();
	const loaded = loadConfig();
	const rt = new Runtime(loaded.config, loaded.warnings);

	// Providers must exist before pi picks its startup model, so discovery runs in the (awaited) factory.
	// Servers are asked in parallel with a short timeout.
	const report = await runDiscovery(pi, rt);
	const notes = [...(moveProblem ? [moveProblem] : []), ...loaded.warnings, ...report.warnings, ...report.servers.filter((s) => s.error).map((s) => `${s.name} (${s.origin}) isn't answering: ${s.error}`)];

	registerSummaryLevel(pi, rt);
	registerLevelOnSelect(pi, rt);
	const refreshStatus = registerStatus(pi, rt);
	registerCommand(pi, rt, { rediscover: () => runDiscovery(pi, rt), refreshStatus });

	pi.on("session_start", (_e, ctx) => {
		if (!ctx.hasUI) return;
		// First run: say how to start.
		if (!loaded.exists && !rt.config.engines.some((r) => r.enabled)) ctx.ui.notify("modelctl: no server switched on yet. Type /modelctl and open Servers to pick the one you run.", "info");
		for (const note of notes) ctx.ui.notify(`modelctl: ${note}`, "warning");
	});
}
