// Display helpers: token counts and the status line.
// Pure module: no pi imports, unit-tested in test/format.test.ts.

/** 950 -> "950", 20480 -> "20.5K", 262144 -> "262K", 1048576 -> "1.05M" */
export function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return "?";
  const a = Math.abs(n);
  if (a < 1000) return `${Math.round(n)}`;
  if (a < 100_000) return `${trim((n / 1000).toFixed(1))}K`;
  if (a < 1_000_000) return `${Math.round(n / 1000)}K`;
  return `${trim((n / 1_000_000).toFixed(2))}M`;
}

/** 20480 -> "20,480" */
export function fmtExact(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export interface StatusValues {
  /** Tokens in the context, as pi counts them (null: unknown, e.g. right after a compaction). */
  used: number | null | undefined;
  contextWindow: number;
  /** pi's thinking budget for the current level, when one is sent. */
  thinkingBudget?: number;
  /** Where pi compacts, when it does. */
  compactAt?: number;
}

/** e.g. "ctx 41K/81.9K · think ≤8.2K · compacts at 65.5K". Parts without a value are left out. */
export function statusLine(v: StatusValues): string {
  const parts = [`ctx ${v.used == null ? "?" : fmtTokens(v.used)}/${fmtTokens(v.contextWindow)}`];
  if (v.thinkingBudget !== undefined) parts.push(`think ≤${fmtTokens(v.thinkingBudget)}`);
  if (v.compactAt !== undefined) parts.push(`compacts at ${fmtTokens(v.compactAt)}`);
  return parts.join(" · ");
}

function trim(s: string): string {
  return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}
