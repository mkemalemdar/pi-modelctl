// The /modelctl menu. Every row opens a page or a choice; Esc goes back one level.
//
//   modelctl                    START HERE (until a server is on), GENERAL SETTINGS, MODELS, EXTENSION, DANGER
//   › Thinking budgets          pi's thinking budget per level
//   › Compaction                the summary level for all models, pi's reserve and keep-recent for all models
//   › Models › <model>          one model: hidden, context, thinking, and its compaction values
//   › Servers › <server>        which servers are asked for models
//
// Budgets, reserve and keep-recent are pi's own settings: read from and written to pi's settings.json, applied by
// pi after Reload. Everything else is modelctl.json.

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { freeProviderName, PROVIDER_NAME, renameProvider, setModelSetting, SUMMARY_LEVELS, summaryLevelFor, type SummaryLevel } from "../../core/config.ts";
import { ENGINE_CATALOG, engineInfo, type EngineId } from "../../core/engines.ts";
import { fmtTokens } from "../../core/format.ts";
import { levelName, SUMMARY_LEVEL_HELP, SUMMARY_LEVEL_TEXT, thinkingText } from "../../core/labels.ts";
import { availablePiLevels, thinkingFromSetting, type PiLevel } from "../../core/levels.ts";
import {
	BUDGET_LEVELS,
	budgetPath,
	compactionPath,
	compactionValue,
	PI_DEFAULT_BUDGETS,
	readPath,
	tokenCount,
	type BudgetLevel,
	type CompactionField,
	type SettingPath,
	type Source,
} from "../../core/pisettings.ts";
import type { DiscoveryReport } from "../discovery.ts";
import type { Runtime } from "../runtime.ts";
import { REMOVAL_DETAILS } from "../remove.ts";
import { InputStep, ListMenu, type MenuItem, MenuStack } from "./components.ts";

/** "remove": Remove everything was confirmed; `resetPi` also resets pi's values the menu edits. */
export type PanelResult = "reload" | { remove: true; resetPi: boolean } | undefined;

export interface PanelHost {
	pi: ExtensionAPI;
	rt: Runtime;
	/** Saves modelctl.json; returns a problem to show. */
	save(): string | undefined;
	rediscover(): Promise<DiscoveryReport>;
	refreshStatus(): void;
	/** pi's settings.json. */
	piSettings: {
		read(): { settings: Record<string, unknown> } | { error: string };
		write(path: SettingPath, value: number | undefined): string | undefined;
	};
}

type Scope = { kind: "all" } | { kind: "model"; key: string };

const n = (x: number) => Math.round(x).toLocaleString("en-US");
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const RELOAD_NOTE = "pi's own setting: applies after Reload.";

export function showPanel(ctx: ExtensionCommandContext, host: PanelHost): Promise<PanelResult> {
	const { pi, rt } = host;
	return ctx.ui.custom<PanelResult>((tui, theme, _keybindings, done) => {
		let closed = false;
		const finish = (result: PanelResult) => {
			if (closed) return;
			closed = true;
			done(result);
		};
		const render = () => tui.requestRender();
		// A page rebuilds its rows when a deeper page closes and it's shown again.
		const refreshers = new Map<Component, () => void>();
		const stack = new MenuStack(
			() => finish(undefined),
			() => refreshers.get(stack.top()!)?.(),
		);
		const open = (component: Component, refresh?: () => void) => {
			if (refresh) refreshers.set(component, refresh);
			stack.push(component);
			render();
		};
		/** Rows that fit the terminal before a long page scrolls. */
		const tall = () => Math.max(10, (tui.terminal?.rows ?? 40) - 14);

		// ------------------------------------------------------------ shared

		const selected = () => rt.entryFor(ctx.model);
		const entry = (key: string) => rt.catalog.get(key);

		/** Saves modelctl.json and shows a problem next to `itemId`. */
		const save = (menu: ListMenu, itemId?: string) => {
			const problem = host.save();
			host.refreshStatus();
			if (problem) menu.setStatus(problem, "error", itemId);
		};

		/** Asks the servers again (a change that alters what pi gets); shows problems, or `okText`. */
		const rediscover = (menu: ListMenu, itemId: string | undefined, after: () => void, okText: () => string) => {
			menu.setStatus("checking the servers…", "info", itemId);
			render();
			void host
				.rediscover()
				.then((report) => {
					after();
					const problems = [...report.warnings, ...report.servers.filter((s) => s.error).map((s) => `${s.name} isn't answering`)];
					menu.setStatus(problems.length ? problems.join(" · ") : okText(), problems.length ? "error" : "ok", itemId);
				})
				.catch((err: unknown) => menu.setStatus((err as Error).message, "error", itemId))
				.finally(render);
		};

		/** pi's settings as in the file (what applies after Reload); {} with the problem when it can't be read. */
		const piFile = (): { settings: Record<string, unknown>; error?: string } => {
			const r = host.piSettings.read();
			return "error" in r ? { settings: {}, error: r.error } : r;
		};
		/** " · after Reload" while the file holds a value pi hasn't loaded yet. */
		const pending = (path: SettingPath, file: Record<string, unknown>) =>
			JSON.stringify(readPath(file, path)) === JSON.stringify(readPath(pi.getSettings(), path)) ? "" : " · after Reload";

		/** A whole number of tokens typed into one of pi's settings; empty removes it. */
		const piNumberStep = (title: string, description: string, path: SettingPath, max: number, parent: ListMenu, itemId: string) => {
			const current = tokenCount(readPath(piFile().settings, path));
			open(
				new InputStep(theme, title, description, current === undefined ? "" : String(current), (raw) => {
					const text = raw.trim().replace(/,/g, "");
					let value: number | undefined;
					if (text) {
						value = Number(text);
						if (!Number.isSafeInteger(value) || value < 0 || value > max) return `A whole number of tokens, 0 to ${n(max)}.`;
					}
					const problem = host.piSettings.write(path, value);
					if (problem) return problem;
					stack.pop();
					parent.setStatus("saved · applies after Reload", "ok", itemId);
					return undefined;
				}, () => stack.pop()),
			);
		};

		// ------------------------------------------------------------ main page

		const mainItems = (): MenuItem[] => {
			const e = selected();
			const servers = rt.config.engines;
			const entries = [...rt.catalog.values()];
			const inPi = entries.filter((x) => x.def && !x.hidden).length;
			const unknown = entries.filter((x) => !x.def).length;
			const file = piFile().settings;
			const own = e ? Object.keys(rt.config.models[e.key] ?? {}).length + ownPiValues(file, e.key) : 0;
			return [
				// Nothing reaches pi until a server is on: the first thing a new user sees.
				...(servers.some((x) => x.enabled)
					? []
					: [
							heading("start", "START HERE"),
							{
								id: "start",
								label: "Pick your server",
								indent: 1,
								detail: "none switched on yet",
								description: "Tell modelctl which inference server you run (llama-swap, llama.cpp, Ollama, vLLM, …). Its models then appear in pi.",
							},
							space("general"),
						]),
				heading("general", "GENERAL SETTINGS", "for every model"),
				{
					id: "budgets",
					label: "Thinking budgets",
					indent: 1,
					detail: BUDGET_LEVELS.map((l) => `${l} ${fmtTokens(budgetOf(file, l))}`).join(" · "),
					description: "How long a model may think at each level. pi sends it with every request to servers that take a budget.",
				},
				{
					id: "compaction",
					label: "Compaction",
					indent: 1,
					detail: `summary ${SUMMARY_LEVEL_TEXT[rt.config.summaryLevel]} · reserve ${n(compactionValue(file, "reserveTokens").value)} · keep ${n(compactionValue(file, "keepRecentTokens").value)}`,
					description: "When pi compacts, how much it keeps word for word, and the thinking level the summary is written at.",
				},
				{ id: "status", label: "Status line", indent: 1, detail: rt.config.statusLine ? "on" : "off", description: "Context used, the thinking budget and where pi compacts, in pi's footer. Enter switches it." },
				space("models"),
				heading("models", "MODELS"),
				...(e ? [{ id: "current", label: e.model.id, indent: 1, detail: `selected now · ${own ? plural(own, "own setting") : "no own settings"}`, description: "This model's own settings." }] : []),
				{
					id: "models",
					label: "All models",
					indent: 1,
					detail: [`${inPi} in pi`, ...(entries.length - inPi - unknown > 0 ? [`${entries.length - inPi - unknown} hidden`] : []), ...(unknown ? [`${unknown} need a context size`] : [])].join(" · "),
					description: "Every model your servers offer. Pick one to hide it, set its context or thinking, or give it its own compaction values.",
				},
				space("extension"),
				heading("extension", "EXTENSION"),
				{ id: "servers", label: "Servers", indent: 1, detail: `${servers.filter((x) => x.enabled).length} on · ${plural(rt.catalog.size, "model")}`, description: "The inference servers modelctl asks for models. Only the ones switched on are contacted." },
				{ id: "reload", label: "Reload", indent: 1, description: "pi's /reload: reads pi's settings again (budgets, reserve, keep recent) and asks the servers for their models again." },
				space("danger"),
				heading("danger", "DANGER"),
				{ id: "remove", label: "Remove everything…", indent: 1, description: "Before uninstalling: deletes modelctl.json, and if you choose, the values this menu set in pi's settings. Asks first." },
			];
		};
		const main: ListMenu = new ListMenu(theme, {
			title: "modelctl",
			items: mainItems(),
			hint: "↑↓ move · Enter open · Esc close",
			maxVisible: tall,
			onCancel: () => stack.pop(),
			onSelect: (item) => {
				const e = selected();
				if (item.id === "budgets") budgetsPage();
				else if (item.id === "compaction") compactionPage();
				else if (item.id === "status") {
					rt.config.statusLine = !rt.config.statusLine;
					save(main, "status");
					main.setItems(mainItems());
				} else if (item.id === "current" && e) modelPage(e.key);
				else if (item.id === "models") modelsPage();
				else if (item.id === "servers" || item.id === "start") serversPage();
				else if (item.id === "reload") finish("reload");
				else if (item.id === "remove") removePage();
			},
		});
		open(main, () => main.setItems(mainItems()));

		// ------------------------------------------------------------ remove everything

		function removePage(): void {
			const menu: ListMenu = new ListMenu(theme, {
				title: "modelctl › Remove everything",
				description:
					REMOVAL_DETAILS,
				items: [
					{ id: "cancel", label: "Cancel" },
					{ id: "file", label: "Remove modelctl.json", description: "pi's own settings stay as they are." },
					{
						id: "all",
						label: "Remove modelctl.json and reset pi's values set here",
						description: "Also removes thinkingBudgets and compaction reserveTokens / keepRecentTokens (also per model) from pi's settings.json, so pi uses its defaults. Everything else in that file stays. These values are removed even if you set them some other way.",
					},
				],
				initialId: "cancel",
				hint: "↑↓ move · Enter choose · Esc back",
				onCancel: () => stack.pop(),
				onSelect: (item) => {
					if (item.id === "cancel") stack.pop();
					else finish({ remove: true, resetPi: item.id === "all" });
				},
			});
			open(menu);
		}

		// ------------------------------------------------------------ thinking budgets (pi's)

		function budgetsPage(): void {
			const items = (): MenuItem[] => {
				const { settings, error } = piFile();
				return [
					...BUDGET_LEVELS.map((level) => {
						const own = tokenCount(readPath(settings, budgetPath(level)));
						return {
							id: level,
							label: level,
							detail: `${n(own ?? PI_DEFAULT_BUDGETS[level])}${own === undefined ? " · pi's default" : ""}${pending(budgetPath(level), settings)}`,
							description: level === "high" ? "Also used for xhigh and max." : `pi's default: ${n(PI_DEFAULT_BUDGETS[level])}.`,
						};
					}),
					...(error ? [{ id: "error", label: error, disabled: true }] : []),
				];
			};
			const menu: ListMenu = new ListMenu(theme, {
				title: "modelctl › Thinking budgets",
				description:
					"How many tokens a model may think at each thinking level. pi sends it with every request to servers that take a budget " +
					`(llama.cpp, llama-swap, Strata, vLLM) and always keeps 1,024 for the answer. ${RELOAD_NOTE}`,
				items: items(),
				hint: "↑↓ move · Enter change · Esc back",
				onCancel: () => stack.pop(),
				onSelect: (item) => {
					const level = item.id as BudgetLevel;
					piNumberStep(`modelctl › Thinking budgets › ${level}`, `Tokens, e.g. 4096. Leave empty for pi's default (${n(PI_DEFAULT_BUDGETS[level])}).`, budgetPath(level), 10_000_000, menu, level);
				},
			});
			open(menu, () => menu.setItems(items()));
		}

		// ------------------------------------------------------------ compaction (all models, or one)

		/** The three compaction rows, for all models or one model. */
		const compactionItems = (scope: Scope): MenuItem[] => {
			const { settings } = piFile();
			const key = scope.kind === "model" ? scope.key : undefined;
			const e = key ? entry(key) : undefined;
			const noThinking = e !== undefined && e.thinking.kind === "none";
			const ownLevel = key ? rt.config.models[key]?.summaryLevel : undefined;
			const level = key ? summaryLevelFor(rt.config, key) : rt.config.summaryLevel;
			const value = (field: CompactionField) => {
				const v = compactionValue(settings, field, key);
				return `${n(v.value)} · ${sourceText(v.source, scope)}${pending(compactionPath(field, key), settings)}`;
			};
			return [
				{
					id: "summary",
					label: "Summary thinking level",
					indent: 1,
					detail: noThinking ? "this model doesn't think" : `${SUMMARY_LEVEL_TEXT[level]}${key ? ` · ${ownLevel ? "own" : "all models"}` : ""}`,
					description: "The thinking level the compaction summary is written at. A high level can think so long the summary barely fits.",
					...(noThinking ? { dimmed: true } : {}),
				},
				{
					id: "reserveTokens",
					label: "Reserve tokens",
					indent: 1,
					detail: value("reserveTokens"),
					description: `pi compacts once only this many tokens are left in the context. ${RELOAD_NOTE}`,
				},
				{
					id: "keepRecentTokens",
					label: "Keep recent",
					indent: 1,
					detail: value("keepRecentTokens"),
					description: `How many of the newest tokens stay word for word; only older ones are summarized. ${RELOAD_NOTE}`,
				},
			];
		};

		/** Enter on a compaction row. Returns false for other rows. */
		const onCompactionRow = (item: MenuItem, scope: Scope, menu: ListMenu, path: string): boolean => {
			const key = scope.kind === "model" ? scope.key : undefined;
			if (item.id === "summary") {
				if (item.dimmed) menu.setStatus("this model doesn't think: nothing to choose", "info", item.id);
				else summaryLevelMenu(scope, `${path} › Summary thinking level`, menu);
				return true;
			}
			if (item.id !== "reserveTokens" && item.id !== "keepRecentTokens") return false;
			const field = item.id;
			const label = field === "reserveTokens" ? "Reserve tokens" : "Keep recent";
			const contextWindow = key ? entry(key)?.contextWindow : undefined;
			const fallback = compactionValue(piFile().settings, field, undefined);
			const empty = key ? `the value for all models (${n(fallback.value)})` : `pi's default (${n(compactionValue({}, field).value)})`;
			piNumberStep(
				`${path} › ${label}`,
				`Tokens. Leave empty for ${empty}.${contextWindow ? ` This model's context is ${n(contextWindow)}.` : ""}`,
				compactionPath(field, key),
				contextWindow ?? 100_000_000,
				menu,
				field,
			);
			return true;
		};

		/** On a model: what its compaction values add up to, e.g. a keep-recent that leaves nothing to summarize. */
		const compactionNote = (key: string | undefined): string => {
			const e = key ? entry(key) : selected();
			if (!e?.contextWindow) return "";
			const { settings } = piFile();
			const reserve = compactionValue(settings, "reserveTokens", e.key).value;
			const keep = compactionValue(settings, "keepRecentTokens", e.key).value;
			const at = Math.max(0, e.contextWindow - reserve);
			const warn = keep >= at ? " Keep recent is at least that much, so a compaction can't free anything: lower it, or the reserve." : "";
			return ` On ${e.model.id} (${n(e.contextWindow)}): compacts at ${n(at)} used, keeps the newest ${n(keep)}.${warn}`;
		};

		function compactionPage(): void {
			const scope: Scope = { kind: "all" };
			const description = () => `For every model without its own values (set those on a model's page).${compactionNote(undefined)}`;
			const menu: ListMenu = new ListMenu(theme, {
				title: "modelctl › Compaction",
				description: description(),
				items: compactionItems(scope),
				hint: "↑↓ move · Enter change · Esc back",
				onCancel: () => stack.pop(),
				onSelect: (item) => void onCompactionRow(item, scope, menu, "modelctl › Compaction"),
			});
			open(menu, () => {
				menu.setDescription(description());
				menu.setItems(compactionItems(scope));
			});
		}

		function summaryLevelMenu(scope: Scope, title: string, parent: ListMenu): void {
			const key = scope.kind === "model" ? scope.key : undefined;
			const current = key ? (rt.config.models[key]?.summaryLevel ?? "same") : rt.config.summaryLevel;
			const items: MenuItem[] = [
				...SUMMARY_LEVELS.map((l) => ({
					id: l,
					label: SUMMARY_LEVEL_TEXT[l],
					marker: current === l ? "●" : " ",
					description: SUMMARY_LEVEL_HELP[l],
					...(l === "current" && !key ? { detail: "default" } : {}),
				})),
				...(key ? [{ id: "same", label: "Same as all models", marker: current === "same" ? "●" : " ", detail: SUMMARY_LEVEL_TEXT[rt.config.summaryLevel], description: "Use the level set for all models." }] : []),
			];
			open(
				new ListMenu(theme, {
					title,
					description: "The thinking level pi writes the compaction summary at.",
					items,
					initialId: current,
					onCancel: () => stack.pop(),
					onSelect: (item) => {
						if (key) setModelSetting(rt.config, key, "summaryLevel", item.id === "same" ? undefined : (item.id as SummaryLevel));
						else rt.config.summaryLevel = item.id as SummaryLevel;
						save(parent, "summary");
						stack.pop();
					},
				}),
			);
		}

		// ------------------------------------------------------------ models

		function modelsPage(): void {
			const items = (): MenuItem[] => {
				const entries = [...rt.catalog.values()].sort((a, b) => a.key.localeCompare(b.key));
				if (entries.length === 0) return [{ id: "servers", label: "Open Servers", description: "No models yet. Switch on a server and check its address." }];
				const out: MenuItem[] = [];
				let provider = "";
				for (const e of entries) {
					if (e.provider !== provider) {
						if (provider) out.push(space(e.provider));
						provider = e.provider;
						out.push(heading(provider, provider.toUpperCase()));
					}
					const notes = [
						e.contextWindow ? fmtTokens(e.contextWindow) : "context unknown",
						thinkingText(e.thinking),
						...(e.model.input.includes("image") ? ["images"] : []),
						...(e.hidden ? ["hidden"] : []),
						...(rt.config.models[e.key] ? ["own settings"] : []),
					];
					out.push({
						id: e.key,
						label: e.model.id,
						indent: 1,
						detail: notes.join(" · "),
						description: e.def ? `In pi as ${e.key}.` : "Not in pi yet: its server doesn't say its context. Open it and set Context size.",
						...(e.hidden || !e.def ? { dimmed: true } : {}),
					});
				}
				return out;
			};
			const menu: ListMenu = new ListMenu(theme, {
				title: "modelctl › Models",
				description: "Every model your servers offer.",
				items: items(),
				hint: "↑↓ move · Enter open · Esc back",
				maxVisible: tall,
				onCancel: () => stack.pop(),
				onSelect: (item) => (item.id === "servers" ? serversPage() : entry(item.id) && modelPage(item.id)),
			});
			open(menu, () => menu.setItems(items()));
		}

		function modelPage(key: string): void {
			const first = entry(key)!;
			const base = `modelctl › Models › ${first.model.id}`;
			const scope: Scope = { kind: "model", key };
			const e = () => entry(key) ?? first;
			const items = (): MenuItem[] => {
				const m = e();
				const own = rt.config.models[key] ?? {};
				const levels = availablePiLevels(m.thinking);
				const server = engineInfo(m.row.engine).label;
				const contextSource = own.contextWindow !== undefined ? "set by you" : m.model.contextWindow !== undefined ? "from the server" : undefined;
				return [
					heading("model", "MODEL"),
					{ id: "hidden", label: "Hidden", indent: 1, detail: m.hidden ? "yes" : "no", description: "Hidden models disappear from pi's model list. They stay on the server and here." },
					{
						id: "context",
						label: "Context size",
						indent: 1,
						detail: m.contextWindow ? `${n(m.contextWindow)} · ${contextSource}` : "unknown: set it to use this model",
						description: "How many tokens the server runs this model with. Read from the server; set it only when the server doesn't say or says it wrong. It must match the server's real setting.",
					},
					{
						id: "thinkingType",
						label: "Thinking type",
						indent: 1,
						detail: `${thinkingText(m.thinking)} · ${thinkingFromSetting(own.thinkingType) ? "set by you" : "from the server"}`,
						description: "Whether this model can think, and which levels pi offers. Set it when the server doesn't say (vLLM without --enable-tokenizer-info-endpoint, SGLang, …) or says it wrong.",
					},
					...(levels.length
						? [
								{
									id: "level",
									label: "Thinking level when selected",
									indent: 1,
									detail: own.levelOnSelect ? levelName(m.thinking, own.levelOnSelect) : "keep the current one",
									description: `pi uses one thinking level for every model. With a level set here, pi switches to it whenever you select this model. ${m.model.id} has: ${levels.map((l) => levelName(m.thinking, l)).join(", ")}.`,
								},
							]
						: []),
					space("thinking"),
					heading("thinking", "THINKING BUDGET"),
					m.thinking.kind === "none"
						? { id: "budget", label: "Thinking budget", indent: 1, detail: "this model doesn't think", dimmed: true, description: "Nothing to cap." }
						: m.adapter.budgetField
							? { id: "budget", label: "Thinking budget", indent: 1, detail: "pi's thinking budget per reasoning level", description: `pi sends its budget for the current level with every request (as ${m.adapter.budgetField}). The budgets are the same for every model; Enter opens them.` }
							: { id: "budget", label: "Thinking budget", indent: 1, detail: `not supported by ${server}`, dimmed: true, description: `${server} takes no thinking budget, so this model's thinking can't be capped.` },
					space("compaction"),
					heading("compaction", "COMPACTION", "own, or the same as all models"),
					...compactionItems(scope),
				];
			};
			const server = first.provider === first.row.engine ? first.provider : `${first.provider} (${engineInfo(first.row.engine).label})`;
			const description = () => `${first.model.id} on ${server}.${compactionNote(key)}`;
			const menu: ListMenu = new ListMenu(theme, {
				title: base,
				description: description(),
				items: items(),
				hint: "↑↓ move · Enter change · Esc back",
				maxVisible: tall,
				onCancel: () => stack.pop(),
				onSelect: (item) => {
					if (onCompactionRow(item, scope, menu, base)) return;
					if (item.id === "hidden") {
						setModelSetting(rt.config, key, "hidden", e().hidden ? undefined : true);
						save(menu, "hidden");
						rediscover(menu, "hidden", () => menu.setItems(items()), () => (e().hidden ? "✓ hidden from pi's model list" : "✓ back in pi's model list"));
					} else if (item.id === "context") contextStep(key, menu, () => menu.setItems(items()));
					else if (item.id === "thinkingType") thinkingTypeMenu(key, menu, () => menu.setItems(items()));
					else if (item.id === "level") levelOnSelectMenu(key, menu);
					else if (item.id === "budget") {
						if (item.dimmed) menu.setStatus(item.description ?? "", "info", item.id);
						else budgetsPage();
					}
				},
			});
			open(menu, () => {
				menu.setDescription(description());
				menu.setItems(items());
			});
		}

		function contextStep(key: string, parent: ListMenu, refresh: () => void): void {
			const e = entry(key)!;
			const own = rt.config.models[key]?.contextWindow;
			const server = e.model.contextWindow;
			open(
				new InputStep(
					theme,
					`modelctl › Models › ${e.model.id} › Context size`,
					`Tokens, e.g. 32768.${server !== undefined ? ` Leave empty for the server's ${n(server)}.` : " The server doesn't say it."}`,
					own !== undefined ? String(own) : "",
					(raw) => {
						const text = raw.trim().replace(/,/g, "");
						const value = text ? Number(text) : undefined;
						if (value !== undefined && (!Number.isInteger(value) || value < 256 || value > 100_000_000)) return "A whole number of tokens, at least 256.";
						if (value === undefined && server === undefined) return "The server doesn't say it: type the size the server runs this model with.";
						setModelSetting(rt.config, key, "contextWindow", value);
						save(parent, "context");
						stack.pop();
						// pi's model entry carries the context: register the model again.
						rediscover(parent, "context", refresh, () => `✓ ${n(entry(key)?.contextWindow ?? 0)} tokens`);
						return undefined;
					},
					() => stack.pop(),
				),
			);
		}

		function thinkingTypeMenu(key: string, parent: ListMenu, refresh: () => void): void {
			const e = entry(key)!;
			const own = rt.config.models[key]?.thinkingType as { kind?: string; levels?: string[] } | undefined;
			const current = own?.kind ?? "server";
			const title = `modelctl › Models › ${e.model.id} › Thinking type`;
			const apply = (value: unknown) => {
				setModelSetting(rt.config, key, "thinkingType", value);
				save(parent, "thinkingType");
				// pi's model entry carries the levels: register the model again.
				rediscover(parent, "thinkingType", refresh, () => `✓ ${thinkingText(entry(key)?.thinking ?? e.thinking)}`);
			};
			open(
				new ListMenu(theme, {
					title,
					description: "Which thinking this model can do. Pick what the model really supports: a wrong type sends switches it doesn't understand.",
					items: [
						{ id: "server", label: "As the server says", marker: current === "server" ? "●" : " ", detail: `${thinkingText(e.model.thinking)} · default` },
						{ id: "none", label: "No thinking", marker: current === "none" ? "●" : " ", description: "pi offers no thinking levels for it." },
						{ id: "onoff", label: "On/off", marker: current === "onoff" ? "●" : " ", description: "Thinking can be switched on and off, with no levels." },
						{ id: "levels", label: "Levels…", marker: current === "levels" ? "●" : " ", ...(own?.levels ? { detail: own.levels.join(", ") } : {}), description: "Named levels, e.g. low / medium / high. Pick which ones next." },
					],
					initialId: current,
					onCancel: () => stack.pop(),
					onSelect: (item) => {
						if (item.id === "levels") return levelsChecklist(title, own?.levels ?? ["low", "medium", "high"], (levels) => apply({ kind: "levels", levels }));
						stack.pop();
						apply(item.id === "server" ? undefined : { kind: item.id });
					},
				}),
			);
		}

		/** Ticks the level words a model knows; Esc saves (nothing ticked: no change). */
		function levelsChecklist(title: string, initial: string[], done: (levels: string[]) => void): void {
			const words = ["minimal", "low", "medium", "high", "xhigh", "max"];
			const ticked = new Set(initial);
			const items = (): MenuItem[] => words.map((w) => ({ id: w, label: w, marker: ticked.has(w) ? "[x]" : "[ ]" }));
			const menu: ListMenu = new ListMenu(theme, {
				title: `${title} › Levels`,
				description: "Tick the levels the model's chat template accepts. Thinking can also be switched off.",
				items: items(),
				hint: "↑↓ move · Space/Enter tick · Esc save and back",
				onToggle: (item) => {
					if (ticked.has(item.id)) ticked.delete(item.id);
					else ticked.add(item.id);
					menu.setItems(items());
				},
				onCancel: () => {
					stack.popTo(2);
					if (ticked.size > 0) done(words.filter((w) => ticked.has(w)));
				},
			});
			open(menu);
		}

		function levelOnSelectMenu(key: string, parent: ListMenu): void {
			const e = entry(key)!;
			const current = rt.config.models[key]?.levelOnSelect ?? "keep";
			open(
				new ListMenu(theme, {
					title: `modelctl › Models › ${e.model.id} › Thinking level when selected`,
					description: "pi uses one thinking level for every model, so switching models keeps the level the last one had. Set a level here and pi switches to it whenever you select this model. /thinking still changes it any time.",
					items: [
						{ id: "keep", label: "Keep the current one", marker: current === "keep" ? "●" : " ", detail: "default · pi's normal behaviour" },
						...availablePiLevels(e.thinking).map((l) => ({ id: l, label: levelName(e.thinking, l), marker: current === l ? "●" : " " })),
					],
					initialId: current,
					onCancel: () => stack.pop(),
					onSelect: (item) => {
						setModelSetting(rt.config, key, "levelOnSelect", item.id === "keep" ? undefined : (item.id as PiLevel));
						save(parent, "level");
						stack.pop();
					},
				}),
			);
		}

		// ------------------------------------------------------------ servers

		/** How many models a switched-on server reported. */
		const modelsOf = (provider: string) => [...rt.catalog.values()].filter((e) => e.provider === provider).length;

		const serverItems = (): MenuItem[] => [
			...rt.config.engines.map((r, i) => {
				const models = modelsOf(r.name);
				const error = rt.errors.get(r.name);
				return {
					id: String(i),
					// Two rows of one kind look alike: the provider name tells them apart.
					label: r.name === r.engine ? engineInfo(r.engine).label : `${engineInfo(r.engine).label} (${r.name})`,
					marker: r.enabled ? "[x]" : "[ ]",
					detail: `${r.host}:${r.port}${r.enabled ? (error ? " · isn't answering" : ` · ${plural(models, "model")}`) : ""}`,
					description: `${engineExplain(r.engine)} Models appear in pi as ${r.name}/<model>.${error ? ` Last answer: ${error}` : ""}`,
				};
			}),
			{ id: "add", label: "[ Add a server ]", button: true, description: "Add another row, e.g. a second llama-swap on another machine." },
		];

		function serversPage(): void {
			const menu: ListMenu = new ListMenu(theme, {
				title: "modelctl › Servers",
				description: "Tick the kind of server you run (Space). Enter changes its address, e.g. for another machine.",
				items: serverItems(),
				hint: "↑↓ move · Space tick · Enter open · Esc back",
				onToggle: (item) => {
					if (item.id === "add") return addServer(menu);
					const r = rt.config.engines[Number(item.id)];
					r.enabled = !r.enabled;
					save(menu, item.id);
					menu.setItems(serverItems());
					rediscover(menu, item.id, () => menu.setItems(serverItems()), () => (r.enabled ? `✓ ${plural(modelsOf(r.name), "model")}` : "✓ off"));
				},
				onSelect: (item) => (item.id === "add" ? addServer(menu) : serverPage(Number(item.id), menu)),
				onCancel: () => stack.pop(),
			});
			open(menu, () => menu.setItems(serverItems()));
		}

		function addServer(parent: ListMenu): void {
			open(
				new ListMenu(theme, {
					title: "modelctl › Servers › Add a server",
					description: "Which kind of server?",
					items: ENGINE_CATALOG.map((d) => ({ id: d.id, label: d.label, detail: `port ${d.defaultPort}`, description: engineExplain(d.id) })),
					onCancel: () => stack.pop(),
					onSelect: (item) => {
						const d = engineInfo(item.id as EngineId);
						// Its own provider name: two rows with one name would share model keys and settings.
						rt.config.engines.push({ engine: d.id, enabled: false, host: "127.0.0.1", port: d.defaultPort, name: freeProviderName(rt.config, d.id) });
						save(parent);
						parent.setItems(serverItems(), String(rt.config.engines.length - 1));
						stack.pop();
						serverPage(rt.config.engines.length - 1, parent);
					},
				}),
			);
		}

		function serverPage(i: number, parent: ListMenu): void {
			const row = () => rt.config.engines[i];
			let changed = false;
			const items = (): MenuItem[] => {
				const r = row();
				const def = engineInfo(r.engine);
				const several = rt.config.engines.filter((x) => x.engine === r.engine).length > 1;
				return [
					{ id: "on", label: "On", detail: r.enabled ? "on" : "off", description: "Only servers that are on are contacted. Off removes their models from pi." },
					{ id: "host", label: "Host", detail: r.host, description: "Name or IP address of the machine running the server, e.g. 127.0.0.1." },
					{ id: "port", label: "Port", detail: `${r.port}${r.port === def.defaultPort ? " (default)" : ""}`, description: `The server's port. ${def.label} usually uses ${def.defaultPort}.` },
					{ id: "name", label: "Provider name", detail: r.name, description: `Models appear in pi as ${r.name}/<model>. Letters, digits, dot, dash and underscore.` },
					{ id: "key", label: "API key", detail: r.apiKey ? "set" : "none", description: "Only if the server needs one: the key itself, sent as a Bearer token. Empty = none." },
					...(several ? [{ id: "remove", label: "[ Remove this server ]", button: true, description: "Delete this row. Other rows of the same kind stay." }] : []),
				];
			};
			const title = () => `modelctl › Servers › ${engineInfo(row().engine).label}`;
			const text = (label: string, description: string, initial: string, apply: (v: string) => string | undefined) =>
				open(
					new InputStep(theme, `${title()} › ${label}`, description, initial, (raw) => {
						const problem = apply(raw.trim());
						if (problem) return problem;
						changed = true;
						save(menu);
						stack.pop();
						return undefined;
					}, () => stack.pop()),
				);
			const menu: ListMenu = new ListMenu(theme, {
				title: title(),
				description: engineExplain(row().engine),
				items: items(),
				onCancel: () => {
					stack.pop();
					if (changed) rediscover(parent, String(i), () => parent.setItems(serverItems()), () => "✓ saved");
				},
				onSelect: (item) => {
					const r = row();
					if (item.id === "on") {
						r.enabled = !r.enabled;
						changed = true;
						save(menu, "on");
						menu.setItems(items());
					} else if (item.id === "host") text("Host", "Name or IP address of the machine running the server.", r.host, (v) => (v ? void (r.host = v) : "Type a host name or IP address."));
					else if (item.id === "port")
						text("Port", `A number from 1 to 65535. ${engineInfo(r.engine).label} usually uses ${engineInfo(r.engine).defaultPort}.`, String(r.port), (v) => {
							const p = Number(v);
							if (!Number.isInteger(p) || p < 1 || p > 65535) return "A number from 1 to 65535.";
							r.port = p;
							return undefined;
						});
					else if (item.id === "name")
						text("Provider name", "Models appear in pi as <name>/<model>. Letters, digits, dot, dash and underscore.", r.name, (v) => {
							if (!PROVIDER_NAME.test(v)) return "Only letters, digits, . _ and - are allowed.";
							if (rt.config.engines.some((x) => x !== r && x.name === v)) return `Another server is already called ${v}.`;
							// Models' own settings are stored under provider/model: move them along.
							renameProvider(rt.config, r.name, v);
							r.name = v;
							return undefined;
						});
					else if (item.id === "key")
						text("API key", "The key itself, sent as a Bearer token. Leave empty for none.", r.apiKey ?? "", (v) => {
							if (v) r.apiKey = v;
							else delete r.apiKey;
							return undefined;
						});
					else if (item.id === "remove")
						confirm(`modelctl › Servers › Remove ${engineInfo(r.engine).label}?`, `Delete the row for ${r.host}:${r.port}. Its models disappear from pi.`, "Yes, remove it", () => {
							rt.config.engines.splice(i, 1);
							save(parent);
							stack.pop();
							rediscover(parent, undefined, () => parent.setItems(serverItems()), () => "✓ removed");
						});
				},
			});
			open(menu, () => menu.setItems(items()));
		}

		// ------------------------------------------------------------ helpers

		function confirm(title: string, description: string, yes: string, onYes: () => void): void {
			open(
				new ListMenu(theme, {
					title,
					description,
					items: [
						{ id: "yes", label: yes },
						{ id: "no", label: "Cancel" },
					],
					initialId: "no",
					onCancel: () => stack.pop(),
					onSelect: (item) => {
						stack.pop();
						if (item.id === "yes") onYes();
					},
				}),
			);
		}

		return {
			render: (width: number) => stack.render(width),
			invalidate: () => stack.invalidate(),
			handleInput: (data: string) => {
				stack.handleInput(data);
				render();
			},
		};
	});
}

function heading(id: string, label: string, detail?: string): MenuItem {
	return { id: `h:${id}`, label: `[${label}]`, disabled: true, heading: true, ...(detail ? { detail } : {}) };
}

function space(id: string): MenuItem {
	return { id: `space:${id}`, label: "", disabled: true };
}

function budgetOf(settings: unknown, level: BudgetLevel): number {
	return tokenCount(readPath(settings, budgetPath(level))) ?? PI_DEFAULT_BUDGETS[level];
}

/** How many of pi's per-model compaction values a model has. */
function ownPiValues(settings: unknown, key: string): number {
	return (["reserveTokens", "keepRecentTokens"] as const).filter((f) => tokenCount(readPath(settings, compactionPath(f, key))) !== undefined).length;
}

function sourceText(source: Source, scope: Scope): string {
	if (source === "model") return "own";
	if (source === "all models") return scope.kind === "model" ? "all models" : "set";
	return "pi's default";
}

export function engineExplain(id: EngineId): string {
	switch (id) {
		case "llama-swap":
			return "llama-swap: reads models, context, images and thinking levels from its config.";
		case "llama-server":
			return "llama.cpp's llama-server: reads the model, its context, images and thinking switch.";
		case "strata":
			return "Strata: reads the model, its context, images and thinking levels.";
		case "ollama":
			return "Ollama: reads its models, images and thinking options; the context of a loaded model or its Modelfile. No thinking budget.";
		case "vllm":
			return "vLLM: reads the models and their context. Thinking is known when it runs with --enable-tokenizer-info-endpoint.";
		default:
			return "OpenAI-compatible server: reads the model list, and the context if reported. No thinking switch or budget unless set per model.";
	}
}
