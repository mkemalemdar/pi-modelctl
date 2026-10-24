// Thinking level when selected: pi uses one thinking level for every model, so switching models keeps the level the
// last one had. A model with a level set switches pi to it when you select it (not when a session is resumed).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { clampLevel } from "../core/levels.ts";
import type { Runtime } from "./runtime.ts";

export function registerLevelOnSelect(pi: ExtensionAPI, rt: Runtime): void {
	pi.on("model_select", (event) => {
		if (event.source === "restore") return;
		const entry = rt.entryFor(event.model);
		const wanted = entry ? rt.config.models[entry.key]?.levelOnSelect : undefined;
		if (!entry || !wanted) return;
		const level = clampLevel(entry.thinking, wanted);
		if (level && level !== pi.getThinkingLevel()) pi.setThinkingLevel(level);
	});
}
