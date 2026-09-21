import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { openGitProxy } from "../src/git-proxy.ts";
import type { Forge, PullRequest, PullRequestDraft } from "../src/forge.ts";
import type { RepoConfig } from "../src/workspace.ts";
import { openWorkspace } from "../src/workspace.ts";
import { runOnce } from "../src/work.ts";
import { finished, instance, scripted } from "./helpers.ts";

const run = promisify(execFile);
const scratch: string[] = [];
const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A bare repository with one commit on `main`, and no server in front of it. */
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

async function refsOn(repo: RepoConfig): Promise<string> {
  const { stdout } = await run("git", ["ls-remote", repo.url]);
  return stdout;
}

/** deevy with one Issue assigned to the Agent, ready to be worked. */
async function assigned() {
  const deevy = await instance();
  closers.push(deevy.close);
  await deevy.assign("Ship it");
  return deevy;
}

/** A forge that says what it was asked to open. */
function stubForge(): Forge & { opened: PullRequestDraft[] } {
  const opened: PullRequestDraft[] = [];
  return {
    opened,
    open: (draft) => {
      opened.push(draft);
      return Promise.resolve<PullRequest>({
        url: "https://forge.test/pull/1",
        number: 1,
      });
    },
  };
}

/** What `workRun` is given, with the git proxy the session pushes through. */
function work(deevy: Awaited<ReturnType<typeof instance>>, repo: RepoConfig, forge?: Forge) {
  return {
    ...(forge ? { forge } : {}),
    deevy: deevy.deevy,
    proxy: deevy.proxy,
    runTimeoutMs: 20_000,
    gitProxy: async () => {
      const proxy = await openGitProxy({ upstream: repo.url });
      closers.push(() => proxy.close());
      return proxy;
    },
    workspace: (options: { runId: string; originUrl?: string }) =>
      openWorkspace({ ...options, repo }),
  };
}

describe("a session that runs its own git", () => {
  it("pushes the branch it chose, and the remote has it", async () => {
    const deevy = await assigned();
    const repo = await remote();

    let pushedTo = "";
    const session = scripted([
      async (input) => {
        const git = (args: string[]) => run("git", ["-C", input.cwd, ...args]);
        pushedTo = (await git(["remote", "get-url", "origin"])).stdout.trim();
        await git(["checkout", "--quiet", "-b", "the-branch-it-chose"]);
        await writeFile(join(input.cwd, "feature.ts"), "export const x = 1;\n");
        await git(["add", "-A"]);
        await git([
          "-c",
          "user.name=a",
          "-c",
          "user.email=a@b.c",
          "commit",
          "-qm",
          "its own words",
        ]);
        await git(["push", "--quiet", "origin", "the-branch-it-chose"]);
      },
      finished,
    ]);

    await runOnce({ ...work(deevy, repo), session });

    expect(await refsOn(repo)).toContain("refs/heads/the-branch-it-chose");
    // And it went through the supervisor rather than straight to the remote,
    // which is the only way it could have carried a credential.
    expect(pushedTo).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });

  it("carries the supervisor's own delivery through the proxy as well", async () => {
    const deevy = await assigned();
    const repo = await remote();

    // A session that writes a file and runs no git: the supervisor branches,
    // commits and pushes for it — through the same proxy, which is what a
    // proxy closed too early quietly breaks.
    const session = scripted([
      async (input) => {
        await writeFile(join(input.cwd, "written-by-the-session.ts"), "export const y = 2;\n");
      },
      finished,
    ]);

    const pass = await runOnce({ ...work(deevy, repo), session });

    // Named after the attempt, from the key the tracker wrote. The shape of
    // that name moves to the core with `runs.checkout` (docs/plans/sockets.md,
    // slice 6), so what is asserted here is that the supervisor pushed its own
    // branch and said which one.
    const branch = pass.worked[0]?.delivered?.branch ?? "";
    expect(branch.startsWith("deevy/")).toBe(true);
    expect(await refsOn(repo)).toContain(`refs/heads/${branch}`);
  });

  it("never holds the credential that made the push possible", async () => {
    const deevy = await assigned();
    const repo = { ...(await remote()), token: "ghp_the_supervisors_own" };
    let sawInConfig = "";

    const session = scripted([
      async (input) => {
        const { stdout } = await run("git", ["-C", input.cwd, "config", "--list"]);
        sawInConfig = stdout;
      },
      finished,
    ]);

    await runOnce({ ...work(deevy, repo), session });

    // The clone was made with the credential and the session inherits a
    // loopback address: there is nothing in its checkout to find.
    expect(sawInConfig).not.toContain("ghp_the_supervisors_own");
    expect(sawInConfig).toContain("127.0.0.1");
  });

  it("says in the Run's feed what the session pushed", async () => {
    const deevy = await assigned();
    const repo = await remote();

    const session = scripted([
      async (input) => {
        const git = (args: string[]) => run("git", ["-C", input.cwd, ...args]);
        await git(["checkout", "--quiet", "-b", "a-branch"]);
        await writeFile(join(input.cwd, "f.ts"), "export const z = 3;\n");
        await git(["add", "-A"]);
        await git(["-c", "user.name=a", "-c", "user.email=a@b.c", "commit", "-qm", "work"]);
        await git(["push", "--quiet", "origin", "a-branch"]);
      },
      finished,
    ]);

    const pass = await runOnce({ ...work(deevy, repo), session });
    const feed = await deevy.asAda.runs.get({ runId: pass.worked[0].runId });

    expect(feed.activities.map((activity) => activity.body).join("\n")).toMatch(
      /Pushed refs\/heads\/a-branch at [0-9a-f]{7}/,
    );
  });

  it("says plainly when the session rewrote the branch everything is built on", async () => {
    const deevy = await assigned();
    const repo = await remote();

    // The thing no Gate stands in the way of, and the reason the record exists
    // (ADR-0019): an Agent is free to do this, and a Human must be able to see
    // that it did.
    const session = scripted([
      async (input) => {
        const git = (args: string[]) => run("git", ["-C", input.cwd, ...args]);
        await writeFile(join(input.cwd, "README.md"), "# rewritten\n");
        await git(["add", "-A"]);
        await git([
          "-c",
          "user.name=a",
          "-c",
          "user.email=a@b.c",
          "commit",
          "-qm",
          "not the first commit any more",
          "--amend",
        ]);
        await git(["push", "--quiet", "--force", "origin", "main"]);
      },
      finished,
    ]);

    const pass = await runOnce({ ...work(deevy, repo), session });
    const feed = await deevy.asAda.runs.get({ runId: pass.worked[0].runId });

    expect(feed.activities.map((activity) => activity.body).join("\n")).toMatch(
      /Rewrote refs\/heads\/main from [0-9a-f]{7} to [0-9a-f]{7}, which is not a fast-forward/,
    );
  });

  it("attaches the branch the session pushed rather than pushing one of its own", async () => {
    const deevy = await assigned();
    const repo = await remote();
    const forge = stubForge();

    const session = scripted([
      async (input) => {
        const git = (args: string[]) => run("git", ["-C", input.cwd, ...args]);
        await git(["checkout", "--quiet", "-b", "its-own-branch"]);
        await writeFile(join(input.cwd, "f.ts"), "export const z = 3;\n");
        await git(["add", "-A"]);
        await git(["-c", "user.name=a", "-c", "user.email=a@b.c", "commit", "-qm", "its own work"]);
        await git(["push", "--quiet", "origin", "its-own-branch"]);
      },
      finished,
    ]);

    const pass = await runOnce({ ...work(deevy, repo, forge), session });

    // The Run delivered what the session pushed: no second branch of the
    // supervisor's own, a pull request for the agent's, and a Link that says
    // which attempt produced it.
    expect(await refsOn(repo)).not.toContain("refs/heads/deevy/");
    expect(forge.opened.map((draft) => draft.branch)).toEqual(["its-own-branch"]);
    expect(pass.worked[0]?.delivered?.branch).toBe("its-own-branch");
    const links = await deevy.asAda.links.list({ issue: "acme/deevy#1" });
    expect(links.links.map((link) => [link.url, link.runId])).toEqual([
      ["https://forge.test/pull/1", pass.worked[0].runId],
    ]);
  });

  it("puts what the Agent said when it finished onto the pull request", async () => {
    const deevy = await assigned();
    const repo = await remote();
    const forge = stubForge();

    const session = scripted([
      async (input) => {
        await writeFile(join(input.cwd, "health.ts"), "export const ok = true;\n");
        const [run] = await deevy.deevy.runs("pending");
        await deevy.deevy.finishRun(
          run.id,
          "completed",
          "Added a health endpoint, and a smoke that proves it answers.",
        );
      },
      finished,
    ]);

    await runOnce({ ...work(deevy, repo, forge), session });

    expect(forge.opened[0]).toMatchObject({
      title: "acme/deevy#1: Added a health endpoint, and a smoke that proves it answers.",
    });
  });
});
