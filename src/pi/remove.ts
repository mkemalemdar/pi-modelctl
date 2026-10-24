// "Remove everything" in the menu, before uninstalling: modelctl.json (modelctl's only file), and when asked, the
// values of pi's own settings.json that the menu edits (thinking budgets, compaction reserve and keep-recent, also the
// per-model ones). Everything else in pi's settings is left as it is.

import { readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { piSettingsPath, resetMenuValues } from "./pi-settings.ts";
import { configPath } from "./store.ts";

export const UNINSTALL_HINT = "To uninstall, quit pi and run `pi uninstall npm:pi-modelctl` (or the source `pi list` shows).";

/** Removes modelctl's file (and half-written copies of it); resets pi's menu values when `resetPi`. The report lines. */
export function removeEverything(resetPi: boolean, config = configPath(), piSettings = piSettingsPath()): string[] {
  const lines: string[] = [];
  const dir = dirname(config);
  const name = basename(config);
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f === name || f.startsWith(`${name}.tmp-`));
  } catch {
    // No agent folder: nothing to remove.
  }
  for (const f of files) {
    try {
      rmSync(join(dir, f), { force: true });
    } catch (e) {
      lines.push(`⚠ couldn't remove ${join(dir, f)}: ${(e as Error).message}`);
    }
  }
  if (!lines.length) lines.push(files.includes(name) ? `Removed ${config}` : `${config} wasn't there`);
  if (resetPi) {
    const r = resetMenuValues(piSettings);
    if ("error" in r) lines.push(`⚠ pi's settings: ${r.error}`);
    else lines.push(r.removed ? `Reset ${r.removed} value${r.removed === 1 ? "" : "s"} in ${piSettings} to pi's defaults` : `${piSettings} had none of the menu's values`);
  }
  return lines;
}
