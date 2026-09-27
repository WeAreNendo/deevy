/**
 * How a Run's usage and time read (docs/plans/run-usage.md). Every number is
 * what the client running the Agent reported, and a cost is always somebody
 * else's estimate: these say whose, and never put a price on what nobody
 * priced.
 */

/** What deevy calls each harness the reference runtime drives; anything else is shown as sent. */
const harnessNames: Record<string, string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  cursor: "Cursor",
  copilot: "Copilot",
};

export function harnessName(harness: string): string {
  return harnessNames[harness] ?? harness;
}

/** The harnesses a Run's models came from, named, in order and once each: "Claude Code and Cursor". */
export function harnessesOf(models: ReadonlyArray<{ harness: string }>): string {
  const names = [...new Set(models.map((model) => harnessName(model.harness)))];
  if (names.length <= 1) return names[0] ?? "the client";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

const compact = new Intl.NumberFormat("en", { notation: "compact" });

/** A token count the way a person reads one: 274K, 1.5K, 12. */
export function tokens(count: number): string {
  return compact.format(count);
}

/**
 * Dollars: two decimals, and more below a dollar, where a session's cost
 * often sits — "$0.0211" rather than a "$0.02" that says less than the harness did.
 */
export function dollars(usd: number): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: usd >= 1 || usd === 0 ? 2 : 4,
  }).format(usd);
}

/** A length of time in the largest units that say it: "10 s", "25 min", "1 h 20 min". */
export function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  unpricedTokens: number;
  reports: number;
}

/** Every token a Run's usage counts, the prompt cache included. */
export function totalTokens(
  usage: Pick<UsageTotals, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens">,
): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}
