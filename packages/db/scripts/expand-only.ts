/**
 * A migration adds; what it would take away waits for a later release
 * (ADR-0031). A gradual deploy runs two releases on one schema at once, and a
 * rollback runs the older one on whatever the newer one migrated, so the
 * previous release's code has to keep working on this release's schema.
 *
 * This reads every drizzle migration that is not grandfathered and refuses the
 * statements that take something away from code that may still be running:
 * dropping or renaming a table or a column, drizzle-kit's table rebuild (how
 * it changes a column's type, nullability, default or foreign key on SQLite),
 * and a unique index on a table that already holds rows. A migration may still
 * do any of those when it is the later release, and says so on a line of its
 * own, naming an earlier migration that shipped with the release that stopped
 * using what this one removes:
 *
 *     -- deevy: contract <why>, expanded in <earlier migration folder>
 *
 * Whether that earlier migration really shipped is a question about releases,
 * which only git knows, so this checks that it exists and is earlier, and the
 * N-1 smoke (`vp run server#test:previous`) checks that the previous release
 * carried it — and runs that release on this schema, which is the claim itself.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Every migration written before ADR-0031, when a minor release could still
 * break in place. None of them takes anything away, but they are not judged:
 * they shipped, and a rule that changes later should not reopen them. Named
 * rather than cut off at a timestamp, so a folder a skewed clock dated into
 * the past is still checked.
 */
export const grandfathered: ReadonlySet<string> = new Set([
  "20260921073003_init",
  "20260921085855_absent_mattie_franklin",
  "20260921090407_large_triathlon",
  "20260921093619_fuzzy_agent_brand",
  "20260921115301_glorious_makkari",
  "20260923080356_brief_corsair",
  "20260923124622_wild_iron_fist",
  "20260923132322_tiresome_richard_fisk",
  "20260926102028_reflective_ezekiel",
  "20260926103001_watery_prodigy",
  "20261009064016_good_ironclad",
  "20261009070210_chief_squadron_sinister",
  "20261009073317_loose_vulcan",
]);

export interface ExpandOnlyOptions {
  /**
   * The migrations the previous release carried, and its tag. When given, a
   * contraction must name one of them: an expansion that has not shipped yet
   * is one a rollback would undo while this release removes what it replaced.
   */
  shipped?: { release: string; migrations: ReadonlySet<string> };
}

/** Every migration that takes something away without saying it may, empty when none does. */
export async function checkExpandOnly(
  drizzleDir: string,
  { shipped }: ExpandOnlyOptions = {},
): Promise<string[]> {
  const folders = (await readdir(drizzleDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const problems: string[] = [];
  for (const [index, folder] of folders.entries()) {
    if (grandfathered.has(folder)) continue;
    const sql = await readFile(join(drizzleDir, folder, "migration.sql"), "utf8").catch(() => null);
    if (sql === null) continue;
    const source = `drizzle/${folder}/migration.sql`;
    const removals = removalsIn(sql);
    const annotation = contractAnnotation(sql);
    if (annotation === null) {
      for (const removal of removals) {
        problems.push(
          `${source}:${removal.line}: ${removal.what}, ${removal.instead}${HOW_TO_SAY_SO}`,
        );
      }
      continue;
    }
    if (annotation.malformed) {
      problems.push(
        `${source}:${annotation.line}: a contraction names its reason and the earlier ` +
          `migration that expanded, in that form:\n  ${ANNOTATION}`,
      );
      continue;
    }
    const earlier = annotation.expandedIn;
    const position = folders.indexOf(earlier);
    if (position === -1) {
      problems.push(
        `${source}:${annotation.line}: expanded in ${earlier}, which is not a migration in ` +
          `packages/db/drizzle; name the folder of the migration that shipped with the release ` +
          `that stopped using what this one removes`,
      );
    } else if (position >= index) {
      problems.push(
        `${source}:${annotation.line}: expanded in ${earlier}, which is not earlier than this ` +
          `migration; a contraction comes in a later release than its expansion`,
      );
    } else if (shipped && !shipped.migrations.has(earlier)) {
      problems.push(
        `${source}:${annotation.line}: expanded in ${earlier}, which ${shipped.release} does not ` +
          `carry; until a release ships it, rolling back to ${shipped.release} would run code that ` +
          `still uses what this removes. Leave this contraction for the release after the one that ships it`,
      );
    }
  }
  return problems;
}

const ANNOTATION = "-- deevy: contract <why>, expanded in <earlier migration folder>";

const HOW_TO_SAY_SO = ` If this is that later release, say so on a line of its own (ADR-0031):\n  ${ANNOTATION}`;

interface Removal {
  line: number;
  /** What the statement takes away, in words. */
  what: string;
  /** What to do instead, ending in a full stop. */
  instead: string;
}

/** An identifier as SQLite takes one: backticked, double-quoted, bracketed or bare. */
const ID = '(`[^`]+`|"[^"]+"|\\[[^\\]]+\\]|[\\w$]+)';

function unquote(identifier: string): string {
  return /^[`"[]/.test(identifier) ? identifier.slice(1, -1) : identifier;
}

/**
 * The SQL with every comment blanked to spaces, so a statement in a comment
 * is not a statement and every offset still lands on the line it came from.
 */
function withoutComments(sql: string): string {
  const blank = (comment: string) => comment.replace(/[^\n]/g, " ");
  return sql.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/--[^\n]*/g, blank);
}

function lineAt(sql: string, offset: number): number {
  return sql.slice(0, offset).split("\n").length;
}

/** Each statement in `sql` that takes something away, in file order. */
export function removalsIn(source: string): Removal[] {
  const sql = withoutComments(source);
  const removals: Array<Removal & { offset: number }> = [];
  const found = (offset: number, what: string, instead: string) =>
    removals.push({ offset, line: lineAt(sql, offset), what, instead });
  const each = (pattern: string) => sql.matchAll(new RegExp(pattern, "gi"));

  const created = new Set(
    [...each(`\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${ID}`)].map((m) => unquote(m[1]!)),
  );
  // drizzle-kit's rebuild: CREATE `__new_x`, copy x into it, DROP x, RENAME
  // `__new_x` TO x. Named once, as what it is, rather than as the drop and
  // the rename it is made of.
  const rebuilt = new Set<string>();
  for (const name of created) if (name.startsWith("__new_")) rebuilt.add(name.slice(6));
  for (const match of each(`\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${ID}`)) {
    const table = unquote(match[1]!);
    if (!table.startsWith("__new_")) continue;
    found(
      match.index,
      `rebuilds \`${table.slice(6)}\``,
      "which is how drizzle-kit changes a column's type, nullability, default or foreign key " +
        "on SQLite, and the table it leaves may refuse what the previous release reads or " +
        "writes. Add a new column instead — nullable, or with a default — move the code to it, " +
        "and drop the old one in a later release.",
    );
  }
  for (const match of each(`\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${ID}`)) {
    const table = unquote(match[1]!);
    if (rebuilt.has(table)) continue;
    found(
      match.index,
      `drops table \`${table}\``,
      "which the previous release may still read or write. Stop using it in one release and " +
        "leave it in the schema, then drop it in a later release.",
    );
  }
  for (const match of each(`\\bALTER\\s+TABLE\\s+${ID}\\s+RENAME\\s+TO\\s+${ID}`)) {
    const table = unquote(match[1]!);
    if (table.startsWith("__new_") && rebuilt.has(table.slice(6))) continue;
    found(
      match.index,
      `renames table \`${table}\` to \`${unquote(match[2]!)}\``,
      "and the previous release still asks for it by its old name. Create the new table beside " +
        "the old one, move the code to it, and drop the old one in a later release.",
    );
  }
  for (const match of each(
    `\\bALTER\\s+TABLE\\s+${ID}\\s+RENAME\\s+(?:COLUMN\\s+)?(?!TO\\b)${ID}\\s+TO\\s+${ID}`,
  )) {
    found(
      match.index,
      `renames column \`${unquote(match[2]!)}\` of \`${unquote(match[1]!)}\` to \`${unquote(match[3]!)}\``,
      "and the previous release still asks for it by its old name. Add the new column beside the " +
        "old one, write both while the previous release reads the old, and drop the old one in " +
        "a later release.",
    );
  }
  for (const match of each(`\\bALTER\\s+TABLE\\s+${ID}\\s+DROP\\s+(?:COLUMN\\s+)?${ID}`)) {
    found(
      match.index,
      `drops column \`${unquote(match[2]!)}\` of \`${unquote(match[1]!)}\``,
      "which the previous release may still read or write. Stop using it in one release and " +
        "leave it in the schema — still written, or given a default, if it is NOT NULL — then " +
        "drop it in a later release.",
    );
  }
  for (const match of each(
    `\\bCREATE\\s+UNIQUE\\s+INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${ID}\\s+ON\\s+${ID}`,
  )) {
    const table = unquote(match[2]!);
    if (created.has(table) || rebuilt.has(table)) continue;
    found(
      match.index,
      `adds unique index \`${unquote(match[1]!)}\` to \`${table}\``,
      "a table the previous release may still write duplicates into, which it would then " +
        "refuse. Ship the code that keeps those rows unique first, and add the index in a " +
        "later release.",
    );
  }
  return removals
    .sort((a, b) => a.offset - b.offset)
    .map(({ line, what, instead }) => ({ line, what, instead }));
}

type Annotation = { line: number } & (
  | { malformed: true }
  | { malformed: false; reason: string; expandedIn: string }
);

/** The `-- deevy: contract` line, if the migration has one. */
function contractAnnotation(sql: string): Annotation | null {
  const lines = sql.split("\n");
  const index = lines.findIndex((line) => /^\s*--\s*deevy:\s*contract\b/i.test(line));
  if (index === -1) return null;
  const parsed =
    /^\s*--\s*deevy:\s*contract\s+(?<reason>\S.*?)\s*,\s*expanded\s+in\s+`?(?<expandedIn>[\w-]+)`?\s*\.?\s*$/i.exec(
      lines[index]!,
    );
  const { reason, expandedIn } = parsed?.groups ?? {};
  return reason && expandedIn
    ? { line: index + 1, malformed: false, reason, expandedIn }
    : { line: index + 1, malformed: true };
}
