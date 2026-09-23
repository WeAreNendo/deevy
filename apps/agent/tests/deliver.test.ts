import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { deliver, branchFor } from "../src/deliver.ts";
import { DeevyError, type Deevy } from "../src/deevy.ts";
import { openWorkspace, type RepoConfig } from "../src/workspace.ts";

const run = promisify(execFile);
const scratch: string[] = [];
afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

/**
 * A bare repository to push into, and a clone of it. Real git, no network: a
 * branch that exists on the remote afterwards is the claim, and only git can
 * settle it.
 */
async function remote(): Promise<RepoConfig> {
  const dir = await mkdtemp(join(tmpdir(), "deevy-remote-"));
  scratch.push(dir);
  const bare = join(dir, "origin.git");
  const seed = join(dir, "seed");
  await run("git", ["init", "--bare", "--initial-branch", "main", "--quiet", bare]);
  await run("git", ["clone", "--quiet", bare, seed]);
  await run("git", ["-C", seed, "config", "user.email", "seed@deevy.test"]);
  await run("git", ["-C", seed, "config", "user.name", "seed"]);
  await writeFile(join(seed, "README.md"), "# a repository\n");
  await run("git", ["-C", seed, "add", "-A"]);
  await run("git", ["-C", seed, "commit", "--quiet", "-m", "first"]);
  await run("git", ["-C", seed, "push", "--quiet", "origin", "main"]);
  return { url: bare, baseBranch: "main" };
}

type Asked = { runId: string; head?: string; summary?: string };

/**
 * deevy, as far as the delivery can tell: the one call it makes is `pulls.open`
 * (ADR-0024). `has` says whether this Project is bound to a repository, which
 * is the difference between a pull request and a branch with none.
 */
function fakeDeevy(has = true): Deevy & { asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    openPull: (input: Asked) => {
      asked.push(input);
      if (!has) throw new DeevyError("NOT_FOUND", 404, "This Project has no repository");
      return Promise.resolve({ url: "https://tracker.test/pull/7", number: 7 });
    },
  } as unknown as Deevy & { asked: Asked[] };
}

const author = { name: "Planner", email: "planner@deevy.test" };
const branch = "deevy/acme-deevy-42-abcdef12";

describe("what a Run delivers", () => {
  it("is a commit and a push on the branch deevy named, and the pull request it opened", async () => {
    const repo = await remote();
    const workspace = await openWorkspace({ runId: "run_abcdef123456", repo });
    scratch.push(workspace.cwd);
    await writeFile(join(workspace.cwd, "answer.txt"), "42\n");
    const deevy = fakeDeevy();

    const delivered = await deliver({
      workspace,
      deevy,
      branch,
      issueKey: "acme/deevy#42",
      runId: "run_abcdef123456",
      author,
    });

    expect(delivered).toMatchObject({
      branch,
      pullRequest: { url: "https://tracker.test/pull/7", number: 7 },
    });
    // On the remote, which is the only place it counts.
    const { stdout } = await run("git", ["-C", repo.url, "branch", "--list"]);
    expect(stdout).toContain(branch);
    // And deevy is what opened it, for the branch that was pushed.
    expect(deevy.asked).toEqual([{ runId: "run_abcdef123456", head: branch }]);
  });

  it("delivers twice on one Run, because a Gate ruling brings it back", async () => {
    // A Run that stops at a Gate and resumes delivers on both passes, from a
    // fresh clone each time. Branching from the base again would be a
    // non-fast-forward push and the second pass's work would never reach the
    // remote (docs/plans/agent-owns-git.md).
    const repo = await remote();
    const deevy = fakeDeevy();
    const options = {
      deevy,
      branch,
      issueKey: "acme/deevy#42",
      runId: "run_abcdef123456",
      author,
    };

    const first = await openWorkspace({ runId: "run_abcdef12", repo });
    scratch.push(first.cwd);
    await writeFile(join(first.cwd, "before-the-gate.ts"), "export const a = 1;\n");
    const one = await deliver({ ...options, workspace: first });

    const second = await openWorkspace({ runId: "run_abcdef12", repo });
    scratch.push(second.cwd);
    await writeFile(join(second.cwd, "after-the-ruling.ts"), "export const b = 2;\n");
    const two = await deliver({ ...options, workspace: second });

    expect(two?.branch).toBe(one?.branch);
    const { stdout } = await run("git", ["-C", repo.url, "log", "--format=%s", one?.branch ?? ""]);
    expect(stdout.split("\n").filter(Boolean)).toHaveLength(3);
  });

  it("says what the Agent said, on the commit and in what deevy is given", async () => {
    const repo = await remote();
    const workspace = await openWorkspace({ runId: "run_abcdef12", repo });
    scratch.push(workspace.cwd);
    await writeFile(join(workspace.cwd, "health.ts"), "export const ok = true;\n");
    const deevy = fakeDeevy();

    await deliver({
      workspace,
      deevy,
      branch,
      issueKey: "acme/deevy#42",
      runId: "run_abcdef12",
      author,
      summary: "Added a health endpoint, and a smoke that proves it answers.",
    });

    // The commit subject is what a git log shows. The pull request's own title
    // is deevy's to write from the same summary (packages/core/src/forge.ts).
    const { stdout } = await run("git", ["-C", repo.url, "log", "-1", "--format=%s", branch]);
    expect(stdout.trim()).toBe(
      "acme/deevy#42: Added a health endpoint, and a smoke that proves it answers.",
    );
    expect(deevy.asked[0]?.summary).toBe(
      "Added a health endpoint, and a smoke that proves it answers.",
    );
  });

  it("keeps its own line when the Agent finished without saying anything", async () => {
    const repo = await remote();
    const workspace = await openWorkspace({ runId: "run_abcdef12", repo });
    scratch.push(workspace.cwd);
    await writeFile(join(workspace.cwd, "health.ts"), "export const ok = true;\n");

    await deliver({
      workspace,
      deevy: fakeDeevy(),
      branch,
      issueKey: "acme/deevy#42",
      runId: "run_abcdef12",
      author,
    });

    const { stdout } = await run("git", ["-C", repo.url, "log", "-1", "--format=%s", branch]);
    expect(stdout.trim()).toBe("acme/deevy#42: worked by a deevy Agent");
  });

  it("delivers nothing when the session changed nothing", async () => {
    const repo = await remote();
    const workspace = await openWorkspace({ runId: "run_1", repo });
    scratch.push(workspace.cwd);
    const deevy = fakeDeevy();

    // An empty pull request is a worse record than none.
    expect(
      await deliver({
        workspace,
        deevy,
        branch,
        issueKey: "acme/deevy#42",
        runId: "run_1",
        author,
      }),
    ).toBeNull();
    expect(deevy.asked).toEqual([]);
  });

  it("leaves the base branch exactly where it was", async () => {
    const repo = await remote();
    const before = (await run("git", ["-C", repo.url, "rev-parse", "main"])).stdout.trim();
    const workspace = await openWorkspace({ runId: "run_1", repo });
    scratch.push(workspace.cwd);
    await writeFile(join(workspace.cwd, "answer.txt"), "42\n");

    await deliver({
      workspace,
      deevy: fakeDeevy(),
      branch,
      issueKey: "acme/deevy#42",
      runId: "run_1",
      author,
    });

    expect((await run("git", ["-C", repo.url, "rev-parse", "main"])).stdout.trim()).toBe(before);
  });

  it("pushes a branch and opens nothing for a Project deevy has no repository for", async () => {
    // The override: a runtime pointed at a repository deevy has no Socket for
    // still delivers a branch, and `pulls.open` has nothing to open it with.
    // A smaller record rather than a broken one (apps/agent/src/config.ts).
    const repo = await remote();
    const workspace = await openWorkspace({ runId: "run_1", repo });
    scratch.push(workspace.cwd);
    await writeFile(join(workspace.cwd, "answer.txt"), "42\n");

    const delivered = await deliver({
      workspace,
      deevy: fakeDeevy(false),
      branch,
      issueKey: "acme/deevy#42",
      runId: "run_1",
      author,
    });

    expect(delivered?.pullRequest).toBeNull();
    expect(delivered?.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("the branch a Run is delivered on when deevy names none", () => {
  it("is a name git will take, whatever the tracker calls the record", () => {
    // The same shape deevy uses, so a repository behind a Socket and one behind
    // the override are named alike (packages/core/src/forge.ts).
    expect(branchFor("acme/deevy#42", "run_abcdefgh1234")).toBe("deevy/acme-deevy-42-abcdefgh");
    expect(branchFor("ENG-12", "run_abcdefgh1234")).toBe("deevy/eng-12-abcdefgh");
    // Nothing usable in the key still leaves a branch named after the Run.
    expect(branchFor("###", "run_abcdefgh1234")).toBe("deevy/abcdefgh");
  });

  it("gives two attempts at one record two branches", () => {
    expect(branchFor("acme/deevy#1", "run_aaaaaaaa1111")).not.toBe(
      branchFor("acme/deevy#1", "run_bbbbbbbb2222"),
    );
  });
});
