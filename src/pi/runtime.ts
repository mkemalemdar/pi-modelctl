// The extension's state: its settings and the models the servers reported.

import type { Config, Warnings } from "../core/config.ts";
import type { ModelEntry } from "../core/discover.ts";

export class Runtime {
	config: Config;
	/** Problems found in modelctl.json. */
	warnings: Warnings;
	/** Every model the servers reported, hidden and unusable ones too, keyed by `provider/model`. */
	catalog = new Map<string, ModelEntry>();
	/** Provider names registered with pi. */
	providers = new Set<string>();
	/** Servers that gave no models, and why, keyed by provider name. */
	errors = new Map<string, string>();

	constructor(config: Config, warnings: Warnings) {
		this.config = config;
		this.warnings = warnings;
	}

	/** The entry for pi's current model, if it's one of ours. */
	entryFor(model: { provider?: string; id?: string } | undefined): ModelEntry | undefined {
		if (!model?.provider || !model.id) return undefined;
		return this.catalog.get(`${model.provider}/${model.id}`);
	}
}
