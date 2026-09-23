import { DeevyError, type Deevy, type PullRequest } from "./deevy.ts";
import type { Workspace } from "./workspace.ts";

export interface Delivery {
  branch: string;
  commit: string;
  pullRequest: PullRequest | null;
}

export interface DeliverOptions {
  workspace: Workspace;
  /** Where the pull request is opened: through deevy, never by the runtime (ADR-0024). */
  deevy: Deevy;
  issueKey: string;
  runId: string;
  /**
   * The branch to deliver on. deevy names it with the Run's checkout, so the
   * supervisor and the pull request agree on what it is called; a runtime
   * working a repository deevy has no Socket for names its own (`branchFor`).
   */
  branch: string;
  /** Who the commit is by. The Agent, because everything it does is its own. */
  author: { name: string; email: string };
  /**
   * What the Agent said when it finished, which is what a reviewer reads.
   *
   * Its reasoning is in the Run's feed and nobody opening a pull request goes
   * looking there; this is the one line that reaches the code review. Absent —
   * a Run that finished without a summary — the runtime's own line stands, so
   * nothing regresses (docs/plans/agent-owns-git.md).
   */
  summary?: string;
}

/**
 * The branch a Run's work is delivered on, when deevy did not name one.
 *
 * The same shape as `packages/core/src/forge.ts`, for the repository deevy has
 * no Socket for: a tracker's key is not a ref, so the key is reduced to what
 * git takes, and a key with nothing usable in it still leaves a branch named
 * after the Run.
 */
export function branchFor(issueKey: string, runId: string): string {
  const slug = issueKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `deevy/${slug ? `${slug}-` : ""}${runId.replace(/^run_/, "").slice(0, 8)}`;
}

/**
 * What the commit says: the record's key, then the first line of what the
 * Agent said it did.
 *
 * The pull request's own title is deevy's to write, from the same summary
 * (`packages/core/src/forge.ts`). This is the commit subject, which is what a
 * git log shows and what a reviewer sees before they open anything.
 */
export function titleFor(issueKey: string, summary?: string): string {
  const first = (summary ?? "").trim().split("\n")[0]?.trim() ?? "";
  if (first === "") return `${issueKey}: worked by a deevy Agent`;
  const room = 100 - issueKey.length - 2;
  return `${issueKey}: ${first.length > room ? `${first.slice(0, room - 1)}…` : first}`;
}

/**
 * One Run's branch and its commit, and the pull request deevy opened for them.
 *
 * Nothing is pushed to the base branch — the credential should not be able to,
 * and this does not try. A Run that changed no file delivers nothing: an empty
 * pull request is a worse record than none.
 */
export async function deliver(options: DeliverOptions): Promise<Delivery | null> {
  const { workspace, branch } = options;
  const dirty = await workspace.git(["status", "--porcelain"]);
  if (dirty === "") return null;

  // A Run that stopped at a Gate and was resumed delivers twice, from a fresh
  // clone each time. Branching from the base again would push a history the
  // remote's own branch is not part of, which git rejects and which loses the
  // second pass's work; continuing the branch keeps both passes on it
  // (docs/plans/agent-owns-git.md).
  const already = await workspace.git(["ls-remote", "--heads", "origin", branch]).catch(() => "");
  if (already.trim() === "") {
    await workspace.git(["checkout", "-b", branch]);
  } else {
    await workspace.git(["fetch", "--quiet", "origin", branch]);
    await workspace.git(["checkout", "--quiet", "-B", branch, "FETCH_HEAD"]);
  }
  await workspace.git(["add", "-A"]);
  await workspace.git([
    "-c",
    `user.name=${options.author.name}`,
    "-c",
    `user.email=${options.author.email}`,
    "commit",
    "--quiet",
    "-m",
    titleFor(options.issueKey, options.summary),
  ]);
  const commit = await workspace.git(["rev-parse", "HEAD"]);
  await workspace.git(["push", "--quiet", "origin", branch]);

  return { branch, commit, pullRequest: await openPull(options, branch) };
}

/**
 * The pull request, through deevy.
 *
 * deevy holds the Socket, so deevy opens it and attaches it to the record
 * itself (packages/core/src/operations/pulls.ts). A Project deevy has no
 * repository for answers `NOT_FOUND`, and that is a branch pushed and no pull
 * request — a smaller record rather than a broken one, and the operator can
 * see the branch.
 */
export async function openPull(
  options: Pick<DeliverOptions, "deevy" | "runId" | "summary">,
  branch: string,
): Promise<PullRequest | null> {
  try {
    return await options.deevy.openPull({
      runId: options.runId,
      head: branch,
      ...(options.summary ? { summary: options.summary } : {}),
    });
  } catch (error) {
    if (error instanceof DeevyError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}
