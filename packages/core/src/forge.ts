/**
 * The code half of a Run (ADR-0014, ADR-0019, ADR-0024).
 *
 * Three names deevy decides and the runtime reads rather than invents: the
 * branch a Run cuts, what its pull request is called, and what its body says.
 * They live here because both sides need them to agree — the core mints the
 * credential and opens the pull request, and the supervisor pushes the branch
 * in between — and a name each of them made up separately would differ the
 * first time somebody changed one.
 */

/** How much of a summary a pull request title can carry. GitHub's own limit is generous; this is readable. */
const TITLE_LENGTH = 100;

/**
 * What the pull request is called: the record's key, then the first line of
 * what the Agent said it did. The key leads because a list of pull requests is
 * read by somebody looking for one record.
 */
export function titleFor(issueKey: string, summary?: string): string {
  const first = (summary ?? "").trim().split("\n")[0]?.trim() ?? "";
  if (first === "") return `${issueKey}: worked by a deevy Agent`;
  const room = TITLE_LENGTH - issueKey.length - 2;
  return `${issueKey}: ${first.length > room ? `${first.slice(0, room - 1)}…` : first}`;
}

/**
 * The branch one Run works on: the record, then eight characters of the Run's
 * id, so two attempts at one record cannot collide and a Human reading the
 * branch list can tell which is which.
 */
export function branchFor(issueKey: string, runId: string): string {
  const slug = issueKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `deevy/${slug ? `${slug}-` : ""}${runId.replace(/^run_/, "").slice(0, 8)}`;
}

export interface PullBodyInput {
  summary?: string | null;
  /** The record's own URL in the tracker, which is what GitHub closes on merge. */
  issueUrl: string;
  runId: string;
  /** The Agent that opened it: the forge shows the App as the author. */
  agentName?: string | null;
}

/**
 * What the pull request says: the Agent's own summary, the record it closes,
 * and the Run that produced it.
 *
 * `Closes <url>` is GitHub's convention and the whole reason the record's URL
 * is canonical in deevy: a merge closes the record where the team reads it,
 * without deevy writing anything.
 */
export function pullBody({ summary, issueUrl, runId, agentName }: PullBodyInput): string {
  return [(summary ?? "").trim(), `Closes ${issueUrl}`, pullSignature(runId, agentName)]
    .filter((block) => block !== "")
    .join("\n\n");
}

/**
 * The line a pull request ends with, as a comment on the record ends
 * (sockets/mirror.ts): which Agent, which attempt, and that deevy carried it.
 */
export function pullSignature(runId: string, agentName?: string | null): string {
  return `— ${agentName ?? "A deevy Agent"} · ${runId} · via deevy`;
}
