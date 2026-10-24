// pi's own settings that the modelctl menu edits for you, with pi's defaults:
//   thinkingBudgets.<level>                                 how long a model may think at each level
//   compaction.reserveTokens / .keepRecentTokens            when to compact, and how much stays word for word
//   compaction.modelOverrides["<provider/model>"].<field>   the same, for one model
// pi reads them from its settings.json at startup and on /reload. modelctl changes one value at a time, keeps
// everything else in the file as it is, and stores nothing of its own.
// Pure module, unit-tested in test/pisettings.test.ts.

import { isObject } from "./config.ts";

/** pi's built-in defaults (pi-coding-agent docs/compaction.md, pi-ai DEFAULT_THINKING_BUDGETS). */
export const PI_DEFAULT_RESERVE = 16384;
export const PI_DEFAULT_KEEP_RECENT = 20000;
export const BUDGET_LEVELS = ["minimal", "low", "medium", "high"] as const;
export type BudgetLevel = (typeof BUDGET_LEVELS)[number];
export const PI_DEFAULT_BUDGETS: Record<BudgetLevel, number> = { minimal: 1024, low: 2048, medium: 8192, high: 16384 };

export type CompactionField = "reserveTokens" | "keepRecentTokens";
const COMPACTION_DEFAULTS: Record<CompactionField, number> = { reserveTokens: PI_DEFAULT_RESERVE, keepRecentTokens: PI_DEFAULT_KEEP_RECENT };

/** A path into settings.json (model keys contain dots and slashes, so not a dotted string). */
export type SettingPath = readonly string[];

export const budgetPath = (level: BudgetLevel): SettingPath => ["thinkingBudgets", level];
export const compactionPath = (field: CompactionField, modelKey?: string): SettingPath =>
  modelKey === undefined ? ["compaction", field] : ["compaction", "modelOverrides", modelKey, field];

type Obj = Record<string, unknown>;

/** The value at `path`, or undefined. */
export function readPath(settings: unknown, path: SettingPath): unknown {
  let node: unknown = settings;
  for (const key of path) {
    if (!isObject(node)) return undefined;
    node = node[key];
  }
  return node;
}

/**
 * A copy of `settings` with one value set, or removed when `value` is undefined. Objects left empty by a removal
 * are removed too, so the file only keeps what someone set.
 */
export function writePath(settings: Obj, path: SettingPath, value: number | undefined): Obj {
  const root = structuredClone(settings);
  const parents: Obj[] = [root];
  let node = root;
  for (const key of path.slice(0, -1)) {
    if (!isObject(node[key])) {
      if (value === undefined) return root;
      node[key] = {};
    }
    node = node[key] as Obj;
    parents.push(node);
  }
  const leaf = path[path.length - 1];
  if (value !== undefined) {
    node[leaf] = value;
    return root;
  }
  delete node[leaf];
  for (let i = parents.length - 1; i > 0; i--) {
    if (Object.keys(parents[i]).length > 0) break;
    delete parents[i - 1][path[i - 1]];
  }
  return root;
}

const COMPACTION_FIELDS: readonly CompactionField[] = ["reserveTokens", "keepRecentTokens"];

/** Every value in `settings` that the modelctl menu edits: the budgets, and compaction for all models and per model. */
export function menuValuePaths(settings: unknown): SettingPath[] {
  const paths: SettingPath[] = [...BUDGET_LEVELS.map(budgetPath), ...COMPACTION_FIELDS.map((f) => compactionPath(f))];
  const overrides = readPath(settings, ["compaction", "modelOverrides"]);
  if (isObject(overrides)) for (const key of Object.keys(overrides)) paths.push(...COMPACTION_FIELDS.map((f) => compactionPath(f, key)));
  return paths.filter((p) => readPath(settings, p) !== undefined);
}

/** A whole, non-negative token count as pi accepts it; anything else counts as not set. */
export function tokenCount(v: unknown): number | undefined {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
}

export type Source = "model" | "all models" | "pi's default";

/** A compaction value as pi applies it to a model: the model's own, else the one for all models, else pi's default. */
export function compactionValue(settings: unknown, field: CompactionField, modelKey?: string): { value: number; source: Source } {
  const own = modelKey === undefined ? undefined : tokenCount(readPath(settings, compactionPath(field, modelKey)));
  if (own !== undefined) return { value: own, source: "model" };
  const all = tokenCount(readPath(settings, compactionPath(field)));
  if (all !== undefined) return { value: all, source: "all models" };
  return { value: COMPACTION_DEFAULTS[field], source: "pi's default" };
}

/** pi's thinking budget for a level (xhigh and max use high, as in pi). Undefined for "off". */
export function thinkingBudget(settings: unknown, level: string): number | undefined {
  if (level === "off") return undefined;
  const key = (level === "xhigh" || level === "max" ? "high" : level) as BudgetLevel;
  if (!BUDGET_LEVELS.includes(key)) return undefined;
  return tokenCount(readPath(settings, budgetPath(key))) ?? PI_DEFAULT_BUDGETS[key];
}

/** Whether pi compacts on its own (`compaction.enabled`, on unless set to false). */
export function compactionEnabled(settings: unknown): boolean {
  return readPath(settings, ["compaction", "enabled"]) !== false;
}
