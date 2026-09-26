import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { run as runTable, runUsage as runUsageTable, usageCostBases, type Db } from "@deevy/db";

/**
 * What a Run spent, as the client that ran its Agent reported it
 * (docs/plans/run-usage.md). Every number is a report: deevy adds reports up
 * and never prices a token itself, so a cost nobody reported stays null and
 * the tokens behind it are said apart rather than folded into a total.
 */

/** A Run takes this many reports, one per session; a Run resumed after every Gate stays far under it. */
export const MAX_REPORTS_PER_RUN = 100;

/** The most one report may say it cost, across its models: past it is a mistake, not a session. */
export const MAX_COST_PER_REPORT_USD = 10_000;

/** A report's session is this long closed once its Run finished. */
export const REPORT_GRACE_MS = 24 * 60 * 60 * 1000;

const tokens = z.number().int().min(0).max(1_000_000_000_000);

export const ReportedModelSchema = z.object({
  /** The model, as the harness names it. Absent where the harness did not say. */
  model: z.string().trim().min(1).max(200).nullish(),
  inputTokens: tokens,
  outputTokens: tokens,
  /** Prompt cache: read from it, and written to it. Most of an agent session's input is the first. */
  cacheReadTokens: tokens.default(0),
  cacheWriteTokens: tokens.default(0),
  /** What the harness said this cost, in dollars. Absent where it did not price it. */
  costUsd: z.number().min(0).max(MAX_COST_PER_REPORT_USD).nullish(),
  /** Which price table the harness used, where it says (Claude Code's `costBasis`). */
  costBasis: z.enum(usageCostBases).nullish(),
});

export const ReportUsageInput = z
  .object({
    runId: z.string(),
    /** Your key for one session. The same key again replaces what it said before. */
    report: z.string().trim().min(1).max(200),
    /** What ran the session: `claude-code`, `opencode`, `cursor`, `copilot`, or your own word. */
    harness: z.string().trim().min(1).max(60),
    models: z.array(ReportedModelSchema).min(1).max(20),
  })
  .superRefine((input, context) => {
    const seen = new Set<string>();
    for (const [index, entry] of input.models.entries()) {
      const name = entry.model ?? "";
      if (seen.has(name)) {
        context.addIssue({
          code: "custom",
          path: ["models", index, "model"],
          message: name ? `${name} is reported twice` : "Only one model may go unnamed",
        });
      }
      seen.add(name);
    }
    const cost = input.models.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);
    if (cost > MAX_COST_PER_REPORT_USD) {
      context.addIssue({
        code: "custom",
        path: ["models"],
        message: `One report may cost at most $${String(MAX_COST_PER_REPORT_USD)}`,
      });
    }
  });

/** A Run's totals: what the feed shows, and what a report answers. */
export const UsageSchema = z.object({
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  /** The sum of what was priced, in dollars; null when nothing was. */
  costUsd: z.number().nullable(),
  /** Tokens in reports that carried no cost, which `costUsd` does not cover. */
  unpricedTokens: z.number().int(),
  /** How many sessions reported. */
  reports: z.number().int(),
});

export type Usage = z.infer<typeof UsageSchema>;

/** One model's share of a Run, as one harness reported it. */
export const ModelUsageSchema = z.object({
  harness: z.string(),
  model: z.string().nullable(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  costUsd: z.number().nullable(),
  costBasis: z.enum(usageCostBases).nullable(),
});

export const UsageDetailSchema = UsageSchema.extend({ models: z.array(ModelUsageSchema) });

export const noUsage: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: null,
  unpricedTokens: 0,
  reports: 0,
};

/** Dollars to what is stored: whole micro-dollars, so sums do not drift. */
export function toMicroUsd(dollars: number): number {
  return Math.round(dollars * 1_000_000);
}

const fromMicroUsd = (micro: number | null): number | null =>
  micro === null ? null : micro / 1_000_000;

const sums = {
  inputTokens: sql<number>`coalesce(sum(${runUsageTable.inputTokens}), 0)`,
  outputTokens: sql<number>`coalesce(sum(${runUsageTable.outputTokens}), 0)`,
  cacheReadTokens: sql<number>`coalesce(sum(${runUsageTable.cacheReadTokens}), 0)`,
  cacheWriteTokens: sql<number>`coalesce(sum(${runUsageTable.cacheWriteTokens}), 0)`,
  // A sum over nothing but nulls is null, which is "nobody priced it".
  costMicroUsd: sql<number | null>`sum(${runUsageTable.costMicroUsd})`,
};

/**
 * Each Run's totals in one statement for a whole page, since D1 budgets per
 * statement (docs/plans/m3.md). A Run nobody reported for is absent from the
 * map; `noUsage` is what it spent.
 */
export async function usageOf(db: Db, runIds: string[]): Promise<Map<string, Usage>> {
  const byRun = new Map<string, Usage>();
  if (runIds.length === 0) return byRun;
  const rows = await db
    .select({
      runId: runUsageTable.runId,
      ...sums,
      unpricedTokens: sql<number>`coalesce(sum(case when ${runUsageTable.costMicroUsd} is null then ${runUsageTable.inputTokens} + ${runUsageTable.outputTokens} + ${runUsageTable.cacheReadTokens} + ${runUsageTable.cacheWriteTokens} else 0 end), 0)`,
      reports: sql<number>`count(distinct ${runUsageTable.report})`,
    })
    .from(runUsageTable)
    .where(inArray(runUsageTable.runId, runIds))
    .groupBy(runUsageTable.runId);
  for (const { runId, costMicroUsd, ...row } of rows) {
    byRun.set(runId, { ...row, costUsd: fromMicroUsd(costMicroUsd) });
  }
  return byRun;
}

/** One Run's totals and what each model took, for the Run's own page. */
export async function usageDetailOf(db: Db, runId: string) {
  const [totals, models] = await Promise.all([
    usageOf(db, [runId]),
    db
      .select({
        harness: runUsageTable.harness,
        model: runUsageTable.model,
        costBasis: runUsageTable.costBasis,
        ...sums,
      })
      .from(runUsageTable)
      .where(sql`${runUsageTable.runId} = ${runId}`)
      .groupBy(runUsageTable.harness, runUsageTable.model, runUsageTable.costBasis)
      .orderBy(asc(runUsageTable.harness), asc(runUsageTable.model)),
  ]);
  return {
    ...(totals.get(runId) ?? noUsage),
    models: models.map(({ costMicroUsd, ...row }) => ({
      ...row,
      costUsd: fromMicroUsd(costMicroUsd),
    })),
  };
}

/** One calendar month (UTC) of an Agent's Runs, by the month each Run was created. */
export const AgentMonthSchema = z.object({
  /** `2026-09`. */
  month: z.string(),
  runs: z.number().int(),
  finishedRuns: z.number().int(),
  /** Runs no client said anything about: they count in `runs` and in no total. */
  unreportedRuns: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  costUsd: z.number().nullable(),
  unpricedTokens: z.number().int(),
  workingMs: z.number().int(),
  waitingMs: z.number().int(),
  /**
   * Per finished Run that reported a cost, so a Run nobody priced does not
   * quietly lower it; null when there was none.
   */
  averageCostUsd: z.number().nullable(),
  /** Per finished Run; null when none finished. */
  averageWorkingMs: z.number().int().nullable(),
});

export type AgentMonth = z.infer<typeof AgentMonthSchema>;

/** `2026-09` for a date, in UTC, which is what the months are cut on. */
const monthOf = (date: Date) => date.toISOString().slice(0, 7);

/**
 * The last `months` calendar months of an Agent's Runs, newest first, a month
 * with none included: one statement, grouping the Agent's Runs by the month
 * they were created and joining each to its reports' sums.
 */
export async function agentMonths(
  db: Db,
  agentMemberId: string,
  months: number,
  at = new Date(),
): Promise<AgentMonth[]> {
  const wanted: string[] = [];
  const cursor = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  for (let index = 0; index < months; index += 1) {
    wanted.push(monthOf(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  const since = new Date(`${wanted.at(-1) ?? monthOf(at)}-01T00:00:00Z`);
  const now = at.getTime();

  const spent = db
    .select({
      runId: runUsageTable.runId,
      inputTokens: sql<number>`sum(${runUsageTable.inputTokens})`.as("input_tokens"),
      outputTokens: sql<number>`sum(${runUsageTable.outputTokens})`.as("output_tokens"),
      cacheReadTokens: sql<number>`sum(${runUsageTable.cacheReadTokens})`.as("cache_read_tokens"),
      cacheWriteTokens: sql<number>`sum(${runUsageTable.cacheWriteTokens})`.as(
        "cache_write_tokens",
      ),
      costMicroUsd: sql<number | null>`sum(${runUsageTable.costMicroUsd})`.as("cost_micro_usd"),
      unpricedTokens:
        sql<number>`sum(case when ${runUsageTable.costMicroUsd} is null then ${runUsageTable.inputTokens} + ${runUsageTable.outputTokens} + ${runUsageTable.cacheReadTokens} + ${runUsageTable.cacheWriteTokens} else 0 end)`.as(
          "unpriced_tokens",
        ),
    })
    .from(runUsageTable)
    .groupBy(runUsageTable.runId)
    .as("spent");

  const end = sql`coalesce(${runTable.finishedAt}, ${now})`;
  const waited = sql`(${runTable.waitingMs} + case when ${runTable.waitingSince} is null then 0 else ${end} - ${runTable.waitingSince} end)`;
  const finished = sql`${runTable.finishedAt} is not null`;
  const rows = await db
    .select({
      month: sql<string>`strftime('%Y-%m', ${runTable.createdAt} / 1000, 'unixepoch')`,
      runs: sql<number>`count(*)`,
      finishedRuns: sql<number>`sum(case when ${finished} then 1 else 0 end)`,
      unreportedRuns: sql<number>`sum(case when ${spent.runId} is null then 1 else 0 end)`,
      inputTokens: sql<number>`coalesce(sum(${spent.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${spent.outputTokens}), 0)`,
      cacheReadTokens: sql<number>`coalesce(sum(${spent.cacheReadTokens}), 0)`,
      cacheWriteTokens: sql<number>`coalesce(sum(${spent.cacheWriteTokens}), 0)`,
      costMicroUsd: sql<number | null>`sum(${spent.costMicroUsd})`,
      unpricedTokens: sql<number>`coalesce(sum(${spent.unpricedTokens}), 0)`,
      waitingMs: sql<number>`coalesce(sum(case when ${runTable.startedAt} is null then 0 else ${waited} end), 0)`,
      workingMs: sql<number>`coalesce(sum(case when ${runTable.startedAt} is null then 0 else ${end} - ${runTable.startedAt} - ${waited} end), 0)`,
      finishedPriced: sql<number>`sum(case when ${finished} and ${spent.costMicroUsd} is not null then 1 else 0 end)`,
      finishedCostMicroUsd: sql<
        number | null
      >`sum(case when ${finished} then ${spent.costMicroUsd} end)`,
      finishedWorkingMs: sql<number>`coalesce(sum(case when ${finished} and ${runTable.startedAt} is not null then ${runTable.finishedAt} - ${runTable.startedAt} - ${runTable.waitingMs} else 0 end), 0)`,
    })
    .from(runTable)
    .leftJoin(spent, eq(spent.runId, runTable.id))
    .where(and(eq(runTable.agentMemberId, agentMemberId), gte(runTable.createdAt, since)))
    .groupBy(sql`1`);

  const byMonth = new Map(rows.map((row) => [row.month, row]));
  return wanted.map((month) => {
    const row = byMonth.get(month);
    if (!row) {
      return {
        month,
        runs: 0,
        finishedRuns: 0,
        unreportedRuns: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: null,
        unpricedTokens: 0,
        workingMs: 0,
        waitingMs: 0,
        averageCostUsd: null,
        averageWorkingMs: null,
      };
    }
    const { finishedPriced, finishedCostMicroUsd, finishedWorkingMs, costMicroUsd, ...counted } =
      row;
    return {
      ...counted,
      month,
      costUsd: fromMicroUsd(costMicroUsd),
      waitingMs: Math.max(0, Math.round(counted.waitingMs)),
      workingMs: Math.max(0, Math.round(counted.workingMs)),
      averageCostUsd:
        finishedPriced > 0 && finishedCostMicroUsd !== null
          ? Math.round(finishedCostMicroUsd / finishedPriced) / 1_000_000
          : null,
      averageWorkingMs:
        counted.finishedRuns > 0 ? Math.round(finishedWorkingMs / counted.finishedRuns) : null,
    };
  });
}
