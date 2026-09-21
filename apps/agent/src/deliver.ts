import type { Forge, PullRequest } from "./forge.ts";
import type { Workspace } from "./workspace.ts";

export interface Delivery {
  branch: string;
  commit: string;
  pullRequest: PullRequest | null;
}

export interface DeliverOptions {
  workspace: Workspace;
  forge: Forge | null;
  issueKey: string;
  runId: string;
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

/** The Agent's words as one line, or the runtime's when it left none. */
/**
 * The branch a Run's work is delivered on.
 *
 * A tracker's key is not a ref: `acme/deevy#42` would nest the branch under
 * `deevy/acme/`, where it collides with any branch called `deevy/acme`, and a
 * `#` is not a character to put in a ref by choice (ADR-0024). So the key is
 * reduced to what git takes, and a key with nothing usable in it still leaves a
 * branch named after the Run.
 */
export function branchFor(issueKey: string, runId: string): string {
  const slug = issueKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `deevy/${slug ? `${slug}-` : ""}${runId.slice(0, 8)}`;
}

export function titleFor(issueKey: string, summary?: string): string {
  const first = (summary ?? "").trim().split("\n")[0]?.trim() ?? "";
  if (first === "") return `${issueKey}: worked by a deevy Agent`;
  const room = 100 - issueKey.length - 2;
  return `${issueKey}: ${first.length > room ? `${first.slice(0, room - 1)}…` : first}`;
}

/**
 * One Run's branch and its commit, named after the attempt that produced them.
 *
 * The Run's id is in the branch name so two attempts at one Issue cannot
 * collide, and nothing is pushed to the base branch — the credential should not
 * be able to, and this does not try. A Run that changed no file delivers
 * nothing: an empty pull request is a worse record than none.
 */
export async function deliver(options: DeliverOptions): Promise<Delivery | null> {
  const { workspace, issueKey, runId } = options;
  const dirty = await workspace.git(["status", "--porcelain"]);
  if (dirty === "") return null;

  const branch = branchFor(issueKey, runId);
  const base = workspace.repo?.baseBranch ?? "main";
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
    titleFor(issueKey, options.summary),
  ]);
  const commit = await workspace.git(["rev-parse", "HEAD"]);
  await workspace.git(["push", "--quiet", "origin", branch]);

  const pullRequest = options.forge
    ? await options.forge.open({
        branch,
        base,
        title: titleFor(issueKey, options.summary),
        body: [
          ...(options.summary ? [options.summary.trim(), ""] : []),
          `Opened by a deevy Agent working ${issueKey}.`,
          "",
          `The Run that produced it is \`${runId}\`, and its Activity feed in deevy is the account`,
          "of how it got here. A Human decides whether this ships.",
        ].join("\n"),
      })
    : null;

  return { branch, commit, pullRequest };
}
