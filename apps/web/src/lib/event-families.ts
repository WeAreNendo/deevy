/**
 * What the Event log can be filtered to (`routes/settings/events.tsx`), beside
 * the sentences in `event-text.ts` because both answer to the core's
 * `EventKind` union: a kind added there is owed a case in one and its family in
 * the other.
 */

export interface KindFamily {
  label: string;
  /** The part of a kind before its dot: `gate` for `gate.approved`. */
  prefixes: string[];
}

export interface SubjectFamily {
  label: string;
  types: string[];
}

/**
 * Every family of Event kinds the log holds, by what they are about, so the
 * filter reads as the log does. A prefix nothing appends is a filter that
 * always answers nothing, and a family left out is part of the log nobody can
 * pick out; `event-log.test.tsx` holds this against the union both ways. Until
 * 2026-10-22 it offered ten families of seventeen, and not `gate.*`.
 */
export const kindFamilies: KindFamily[] = [
  { label: "Records", prefixes: ["issue", "comment", "delegation"] },
  { label: "Runs and Gates", prefixes: ["run", "gate"] },
  {
    label: "Workspace",
    prefixes: [
      "workspace",
      "member",
      "invitation",
      "allowlist",
      "identity",
      "agent",
      "socket",
      "project",
    ],
  },
  { label: "Delivery", prefixes: ["channel", "routing", "webhook", "email"] },
];

export const subjectFamilies: SubjectFamily[] = [
  { label: "Work", types: ["issue", "run", "gate", "project"] },
  {
    label: "Workspace",
    types: ["member", "invitation", "allowlist_rule", "socket", "channel", "webhook", "workspace"],
  },
];

/**
 * What only an admin's log holds. `events.list` leaves out every Event about an
 * invitation for anybody else, because who was invited is an admin's to read,
 * so offering them the filter would be offering an empty page.
 */
const adminOnly: ReadonlySet<string> = new Set(["invitation"]);

/** The kind families this reader's log can hold. */
export function kindFamiliesFor(admin: boolean): KindFamily[] {
  return kindFamilies.map((family) => ({
    ...family,
    prefixes: family.prefixes.filter((prefix) => admin || !adminOnly.has(prefix)),
  }));
}

/** The subject types this reader's log can hold. */
export function subjectFamiliesFor(admin: boolean): SubjectFamily[] {
  return subjectFamilies.map((family) => ({
    ...family,
    types: family.types.filter((type) => admin || !adminOnly.has(type)),
  }));
}
