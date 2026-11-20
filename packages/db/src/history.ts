/**
 * What is wrong with a database that has applied migrations and none of this
 * release's, or null when it is new or shares this release's history.
 *
 * deevy's migration history started afresh in 0.12 (ADR-0031's one exception,
 * docs/plans/simplify.md slice 12), so a database a release before it wrote
 * names only migrations this release does not have. drizzle decides what is
 * pending by name alone, would take every one of this release's as pending,
 * and would fail building the first table over the one already there. Each
 * migrator asks this first, and says what it answers.
 */
export function unrelatedHistory(
  applied: readonly string[],
  known: readonly string[],
): string | null {
  if (applied.length === 0 || applied.some((name) => known.includes(name))) return null;
  const span = applied.length === 1 ? applied[0] : `${applied[0]} to ${applied.at(-1)}`;
  return (
    `was written by a deevy from before 0.12, or by something other than deevy: it has ` +
    `applied ${span} and none of this release's migrations, because deevy's migration ` +
    `history started afresh in 0.12`
  );
}
