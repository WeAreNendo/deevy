import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { openGitProxy } from "../src/git-proxy.ts";
import type { Checkout } from "../src/deevy.ts";
import { runOnce } from "../src/work.ts";
import { bareRepo, finished, instance, scripted } from "./helpers.ts";

const run = promisify(execFile);
const scratch: string[] = [];
const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function refsOn(repo: string): Promise<string> {
  const { stdout } = await run("git", ["ls-remote", repo]);
  return stdout;
}

/**
 * deevy with one record assigned to the Agent and a repository behind it.
 *
 * The Project is bound to a forge Socket, so the checkout every Run gets — the
 * clone URL, the branch and the credential — is deevy's answer rather than
 * this test's invention (ADR-0024).
 */
async function assigned() {
  const repo = await bareRepo();
  scratch.push(repo.dir);
  const deevy = await instance({ repo: repo.path });
  closers.push(deevy.close);
  await deevy.assign("Ship it");
  return { ...deevy, repo: repo.path };
}

/** What `workRun` is given, with the git proxy the session pushes through. */
function work(deevy: Awaited<ReturnType<typeof assigned>>) {
  return {
    deevy: deevy.deevy,
    proxy: deevy.proxy,
    runTimeoutMs: 20_000,
    // The proxy deevy's own checkout named, closed by the test rather than by
    // the supervisor: a test that leaves a listener behind hangs the run.
    gitProxy: async (checkout: Checkout) => {
      const proxy = await openGitProxy({ upstream: checkout.cloneUrl, token: checkout.token });
      closers.push(() => proxy.close());
      return proxy;
    },
  };
}

describe("a session that runs its own git", () => {
  it("pushes the branch it chose, and the remote has it", async () => {
    const deevy = await assigned();

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

    await runOnce({ ...work(deevy), session });

    expect(await refsOn(deevy.repo)).toContain("refs/heads/the-branch-it-chose");
    // And it went through the supervisor rather than straight to the remote,
    // which is the only way it could have carried a credential.
    expect(pushedTo).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });

  it("carries the supervisor's own delivery through the proxy as well", async () => {
    const deevy = await assigned();

    // A session that writes a file and runs no git: the supervisor branches,
    // commits and pushes for it — through the same proxy, which is what a
    // proxy closed too early quietly breaks.
    const session = scripted([
      async (input) => {
        await writeFile(join(input.cwd, "written-by-the-session.ts"), "export const y = 2;\n");
      },
      finished,
    ]);

    const pass = await runOnce({ ...work(deevy), session });

    // Named after the attempt, from the key the tracker wrote. The shape of
    // that name moves to the core with `runs.checkout` (docs/plans/sockets.md,
    // slice 6), so what is asserted here is that the supervisor pushed its own
    // branch and said which one.
    const branch = pass.worked[0]?.delivered?.branch ?? "";
    expect(branch.startsWith("deevy/")).toBe(true);
    expect(await refsOn(deevy.repo)).toContain(`refs/heads/${branch}`);
  });

  it("never holds the credential that made the push possible", async () => {
    const deevy = await assigned();
    let sawInConfig = "";
    // The token deevy's forge Socket mints for this Run (tests/helpers.ts).
    const secret = "tracker-token";

    const session = scripted([
      async (input) => {
        const { stdout } = await run("git", ["-C", input.cwd, "config", "--list"]);
        sawInConfig = stdout;
      },
      finished,
    ]);

    await runOnce({ ...work(deevy), session });

    // The clone was made with the credential and the session inherits a
    // loopback address: there is nothing in its checkout to find.
    expect(sawInConfig).not.toContain(secret);
    expect(sawInConfig).toContain("127.0.0.1");
  });

  it("says in the Run's feed what the session pushed", async () => {
    const deevy = await assigned();

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

    const pass = await runOnce({ ...work(deevy), session });
    const feed = await deevy.asAda.runs.get({ runId: pass.worked[0].runId });

    expect(feed.activities.map((activity) => activity.body).join("\n")).toMatch(
      /Pushed refs\/heads\/a-branch at [0-9a-f]{7}/,
    );
  });

  it("says plainly when the session rewrote the branch everything is built on", async () => {
    const deevy = await assigned();

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

    const pass = await runOnce({ ...work(deevy), session });
    const feed = await deevy.asAda.runs.get({ runId: pass.worked[0].runId });

    expect(feed.activities.map((activity) => activity.body).join("\n")).toMatch(
      /Rewrote refs\/heads\/main from [0-9a-f]{7} to [0-9a-f]{7}, which is not a fast-forward/,
    );
  });

  it("attaches the branch the session pushed rather than pushing one of its own", async () => {
    const deevy = await assigned();

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

    const pass = await runOnce({ ...work(deevy), session });

    // The Run delivered what the session pushed: no second branch of the
    // supervisor's own, a pull request for the agent's, and a Link that says
    // which attempt produced it.
    expect(await refsOn(deevy.repo)).not.toContain("refs/heads/deevy/");
    expect(deevy.tracker.pulls.map((draft) => draft.head)).toEqual(["its-own-branch"]);
    expect(pass.worked[0]?.delivered?.branch).toBe("its-own-branch");
    const links = await deevy.asAda.links.list({ issue: "acme/deevy#1" });
    expect(links.links.map((link) => [link.url, link.runId])).toEqual([
      [`https://tracker.test/acme/deevy/pull/1`, pass.worked[0].runId],
    ]);
  });

  it("puts what the Agent said when it finished onto the pull request", async () => {
    const deevy = await assigned();

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

    await runOnce({ ...work(deevy), session });

    // deevy writes the title from the same summary the Agent finished with,
    // which is what reaches the code review (packages/core/src/forge.ts).
    expect(deevy.tracker.pulls[0]).toMatchObject({
      title: "acme/deevy#1: Added a health endpoint, and a smoke that proves it answers.",
    });
  });
});
