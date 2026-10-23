import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, chown, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { openGitProxy } from "../src/git-proxy.ts";
import type { Checkout } from "../src/deevy.ts";
import { mcpEnvelope, mcpProtocolVersion, messagesIn } from "../src/proxy.ts";
import { runOnce } from "../src/work.ts";
import { openWorkspace } from "../src/workspace.ts";
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
    gitProxy: async (checkout: Checkout, hooks: { onPushed: () => Promise<void> }) => {
      const proxy = await openGitProxy({
        upstream: checkout.cloneUrl,
        token: checkout.token,
        ...hooks,
      });
      closers.push(() => proxy.close());
      return proxy;
    },
  };
}

/**
 * `runs_finish` the way the model calls it: through the supervisor's loopback
 * proxy, with no credential, which is the only way a session reaches deevy.
 */
async function finishThroughProxy(mcpUrl: string, runId: string, summary: string): Promise<void> {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": mcpProtocolVersion,
      "mcp-method": "tools/call",
      "mcp-name": "runs_finish",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "runs_finish",
        arguments: { runId, status: "completed", summary },
        _meta: mcpEnvelope,
      },
    }),
  });
  const text = await response.text();
  const answer = messagesIn(text, response.headers.get("content-type") ?? "")[0];
  if (response.status !== 200 || answer?.error) throw new Error(`runs_finish: ${text}`);
}

/** Every Activity in a Run's feed, one per line. */
async function feedOf(deevy: Awaited<ReturnType<typeof assigned>>, runId: string): Promise<string> {
  const run = await deevy.asAda.runs.get({ runId });
  return run.activities.map((activity) => activity.body).join("\n");
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

  it("says what the session pushed in the feed of a Run the session went on to finish", async () => {
    const deevy = await assigned();

    // The usual end of a Run: the session pushes, then finishes its own Run the
    // way it is told to (src/instructions.md, step 11). A finished Run takes no
    // more Activities, so a push said only once the session has ended is a
    // push never said.
    const session = scripted([
      async (input) => {
        const [mine] = await deevy.deevy.runs("pending");
        const git = (args: string[]) => run("git", ["-C", input.cwd, ...args]);
        await git(["checkout", "--quiet", "-b", "a-branch"]);
        await writeFile(join(input.cwd, "f.ts"), "export const z = 3;\n");
        await git(["add", "-A"]);
        await git(["-c", "user.name=a", "-c", "user.email=a@b.c", "commit", "-qm", "work"]);
        await git(["push", "--quiet", "origin", "a-branch"]);
        await finishThroughProxy(input.mcpUrl, mine.id, "Did the work, on a branch of my own.");
      },
      finished,
    ]);

    const pass = await runOnce({ ...work(deevy), session });

    expect(pass.worked[0]?.status).toBe("completed");
    expect(await feedOf(deevy, pass.worked[0].runId)).toMatch(
      /Pushed refs\/heads\/a-branch at [0-9a-f]{7}/,
    );
  });

  it("says what the supervisor pushed for a session that finished without pushing", async () => {
    const deevy = await assigned();

    // A session that changed a file, pushed nothing and finished: the
    // supervisor commits and pushes for it (src/instructions.md, step 8), and
    // has to do it before the finish lands for the push to be in the feed.
    const session = scripted([
      async (input) => {
        const [mine] = await deevy.deevy.runs("pending");
        await writeFile(join(input.cwd, "left-for-the-supervisor.ts"), "export const w = 4;\n");
        await finishThroughProxy(input.mcpUrl, mine.id, "Wrote the file, and pushed nothing.");
      },
      finished,
    ]);

    const pass = await runOnce({ ...work(deevy), session });

    const branch = pass.worked[0]?.delivered?.branch ?? "";
    expect(branch.startsWith("deevy/")).toBe(true);
    expect(pass.worked[0]?.status).toBe("completed");
    expect(await feedOf(deevy, pass.worked[0].runId)).toContain(`Pushed refs/heads/${branch} at `);
    // And the pull request still carries what the Agent said as it finished.
    expect(deevy.tracker.pulls[0]).toMatchObject({
      title: "acme/deevy#1: Wrote the file, and pushed nothing.",
    });
  });

  it("says on the record what a Run's feed would not take, when the finish went round the proxy", async () => {
    const deevy = await assigned();

    // A finish the supervisor never saw: with the key, not through the proxy.
    // The delivery can only come after it, and the feed refuses the push.
    const session = scripted([
      async (input) => {
        const [mine] = await deevy.deevy.runs("pending");
        await writeFile(join(input.cwd, "after-the-finish.ts"), "export const v = 5;\n");
        await deevy.deevy.finishRun(mine.id, "completed", "Finished where nobody was looking.");
      },
      finished,
    ]);

    const pass = await runOnce({ ...work(deevy), session });

    const branch = pass.worked[0]?.delivered?.branch ?? "";
    expect(branch.startsWith("deevy/")).toBe(true);
    expect(await feedOf(deevy, pass.worked[0].runId)).not.toContain("Pushed");
    // deevy signs what it writes in the tracker, so the comment ends with that.
    const said = (deevy.tracker.comments.get("1") ?? []).map((comment) => comment.body);
    expect(said).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^Run \`${pass.worked[0].runId}\` was finished before its feed could say what it moved:\\n\\n- Pushed refs/heads/${branch} at [0-9a-f]{7}\\n`,
        ),
      ),
    );
  });

  it("lets a session's finish through by the Run's deadline, whatever the delivery is doing", async () => {
    const deevy = await assigned();

    let finishedAt = 0;
    const session = scripted([
      async (input) => {
        const [mine] = await deevy.deevy.runs("pending");
        await writeFile(join(input.cwd, "f.ts"), "export const u = 6;\n");
        await finishThroughProxy(input.mcpUrl, mine.id, "Done, with a delivery that hangs.");
        finishedAt = Date.now();
      },
      finished,
    ]);
    const started = Date.now();

    // A push or a pull request that never answers. The finish waits for it,
    // and no longer than the Run's own timeout.
    const pass = await runOnce({
      ...work(deevy),
      runTimeoutMs: 1_500,
      deliver: () => new Promise<never>(() => undefined),
      session,
    });

    expect(pass.worked[0]?.status).toBe("completed");
    expect(finishedAt - started).toBeLessThan(6_000);
    // And the runtime let go after a bound of its own, rather than holding on
    // to a delivery that will never answer.
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);

  it("tells a teammate's push from a rewrite while the session works, and leaves its clone alone", async () => {
    const deevy = await assigned();
    // The clone the remote was seeded from, standing in for a teammate's.
    const teammate = join(dirname(deevy.repo), "seed");

    let fetchHead: boolean | null = null;
    const session = scripted([
      async (input) => {
        // Somebody else moves `main` forward while the Run works, so the
        // commit it points at is one this shallow clone has never seen.
        await writeFile(join(teammate, "theirs.md"), "# not the Agent's\n");
        await run("git", ["-C", teammate, "add", "-A"]);
        await run("git", ["-C", teammate, "commit", "--quiet", "-m", "a teammate's work"]);
        await run("git", ["-C", teammate, "push", "--quiet", "origin", "main"]);

        const git = (args: string[]) => run("git", ["-C", input.cwd, ...args]);
        await git(["checkout", "--quiet", "-b", "a-branch"]);
        await writeFile(join(input.cwd, "f.ts"), "export const z = 3;\n");
        await git(["add", "-A"]);
        await git(["-c", "user.name=a", "-c", "user.email=a@b.c", "commit", "-qm", "work"]);
        await git(["push", "--quiet", "origin", "a-branch"]);
        // The supervisor fetched `main` into this clone to tell, while the
        // session is still in it as another user; what it left must be
        // nothing that user could not then overwrite.
        fetchHead = existsSync(join(input.cwd, ".git", "FETCH_HEAD"));
      },
      finished,
    ]);

    const pass = await runOnce({ ...work(deevy), session });
    const feed = await feedOf(deevy, pass.worked[0].runId);

    expect(feed).toMatch(/^Moved refs\/heads\/main from [0-9a-f]{7} to [0-9a-f]{7}$/m);
    expect(feed).not.toContain("Rewrote");
    expect(fetchHead).toBe(false);
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

/**
 * The clone's `origin`, its configuration and its history are the session's
 * to change, like the rest of its `.git`. What the Run's feed says it moved is
 * read from the remote the supervisor opened, and the supervisor's own push
 * goes there, whatever the clone says by then.
 */
describe("a session whose clone says something else about the remote", () => {
  /**
   * A repository of the session's own: the clone's history, and a branch the
   * remote never had. A feed read through it says a push nobody made and
   * misses the one that happened.
   */
  async function decoy(clone: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "deevy-decoy-"));
    scratch.push(dir);
    const path = join(dir, "decoy.git");
    await run("git", ["clone", "--quiet", "--bare", clone, path]);
    await run("git", ["-C", clone, "push", "--quiet", path, "HEAD:refs/heads/nothing-to-see"]);
    return path;
  }

  it("still has its rewrite of the base branch said, and no push it never made", async () => {
    const deevy = await assigned();

    // The move a Human most needs to read, pushed to the supervisor by its URL
    // once `origin` names a repository where `main` never moved.
    const session = scripted([
      async (input) => {
        const [mine] = await deevy.deevy.runs("pending");
        const git = (args: string[]) => run("git", ["-C", input.cwd, ...args]);
        const supervisor = (await git(["remote", "get-url", "origin"])).stdout.trim();
        await git(["remote", "set-url", "origin", await decoy(input.cwd)]);
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
        await git(["push", "--quiet", "--force", supervisor, "HEAD:refs/heads/main"]);
        await finishThroughProxy(input.mcpUrl, mine.id, "Rewrote main, and pointed origin away.");
      },
      finished,
    ]);

    const pass = await runOnce({ ...work(deevy), session });
    const feed = await feedOf(deevy, pass.worked[0].runId);

    expect(pass.worked[0]?.status).toBe("completed");
    expect(feed).toMatch(
      /^Rewrote refs\/heads\/main from [0-9a-f]{7} to [0-9a-f]{7}, which is not a fast-forward$/m,
    );
    expect(feed).not.toContain("nothing-to-see");
    // And no pull request for a branch only the session's repository has.
    expect(deevy.tracker.pulls).toEqual([]);
  });

  it("still calls a rewrite a rewrite when the clone grafts the old history back on", async () => {
    const deevy = await assigned();

    // A rewrite of `main` whose new commit the clone says descends from the
    // old one, twice over: a replace ref, and a grafts file.
    const session = scripted([
      async (input) => {
        const git = (args: string[]) => run("git", ["-C", input.cwd, ...args]);
        const old = (await git(["rev-parse", "HEAD"])).stdout.trim();
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
        const rewritten = (await git(["rev-parse", "HEAD"])).stdout.trim();
        await git(["replace", "--graft", rewritten, old]);
        await writeFile(join(input.cwd, ".git", "info", "grafts"), `${rewritten} ${old}\n`);
        await git(["push", "--quiet", "--force", "origin", "HEAD:refs/heads/main"]);
      },
      finished,
    ]);

    const pass = await runOnce({ ...work(deevy), session });

    expect(await feedOf(deevy, pass.worked[0].runId)).toMatch(
      /^Rewrote refs\/heads\/main from [0-9a-f]{7} to [0-9a-f]{7}, which is not a fast-forward$/m,
    );
  });

  it("asks the remote, not the clone's origin, for a commit somebody else pushed", async () => {
    const deevy = await assigned();
    // The clone the remote was seeded from, standing in for a teammate's.
    const teammate = join(dirname(deevy.repo), "seed");

    // `main` moves forward while the Run works, to a commit this clone has
    // never seen and the session's own repository never will.
    const session = scripted([
      async (input) => {
        await writeFile(join(teammate, "theirs.md"), "# not the Agent's\n");
        await run("git", ["-C", teammate, "add", "-A"]);
        await run("git", ["-C", teammate, "commit", "--quiet", "-m", "a teammate's work"]);
        await run("git", ["-C", teammate, "push", "--quiet", "origin", "main"]);

        const git = (args: string[]) => run("git", ["-C", input.cwd, ...args]);
        const supervisor = (await git(["remote", "get-url", "origin"])).stdout.trim();
        await git(["remote", "set-url", "origin", await decoy(input.cwd)]);
        await git(["checkout", "--quiet", "-b", "a-branch"]);
        await writeFile(join(input.cwd, "f.ts"), "export const z = 3;\n");
        await git(["add", "-A"]);
        await git(["-c", "user.name=a", "-c", "user.email=a@b.c", "commit", "-qm", "work"]);
        await git(["push", "--quiet", supervisor, "a-branch"]);
      },
      finished,
    ]);

    const pass = await runOnce({ ...work(deevy), session });
    const feed = await feedOf(deevy, pass.worked[0].runId);

    expect(feed).toMatch(/^Moved refs\/heads\/main from [0-9a-f]{7} to [0-9a-f]{7}$/m);
    expect(feed).not.toContain("Rewrote");
  });

  it("still has the supervisor push to the remote, and say so", async () => {
    const deevy = await assigned();
    let elsewhere = "";

    // A session that leaves its work for the supervisor to push, with
    // `origin` naming a repository of its own.
    const session = scripted([
      async (input) => {
        const [mine] = await deevy.deevy.runs("pending");
        elsewhere = await decoy(input.cwd);
        await run("git", ["-C", input.cwd, "remote", "set-url", "origin", elsewhere]);
        await writeFile(join(input.cwd, "left-for-the-supervisor.ts"), "export const s = 8;\n");
        await finishThroughProxy(input.mcpUrl, mine.id, "Left the push to the supervisor.");
      },
      finished,
    ]);

    const pass = await runOnce({ ...work(deevy), session });
    const branch = pass.worked[0]?.delivered?.branch ?? "";
    const feed = await feedOf(deevy, pass.worked[0].runId);

    expect(branch.startsWith("deevy/")).toBe(true);
    expect(await refsOn(deevy.repo)).toContain(`refs/heads/${branch}`);
    expect(await refsOn(elsewhere)).not.toContain(`refs/heads/${branch}`);
    expect(feed).toContain(`Pushed refs/heads/${branch} at `);
    expect(feed).not.toContain("nothing-to-see");
  });

  it("says a delivery the clone sent somewhere else was not delivered, never that it was pushed", async () => {
    const deevy = await assigned();

    // Not `origin` this time, but what git in the clone does with any URL,
    // the one the supervisor names outright included.
    const session = scripted([
      async (input) => {
        const [mine] = await deevy.deevy.runs("pending");
        const git = (args: string[]) => run("git", ["-C", input.cwd, ...args]);
        const supervisor = (await git(["remote", "get-url", "origin"])).stdout.trim();
        await git(["config", `url.${await decoy(input.cwd)}.insteadOf`, supervisor]);
        await writeFile(join(input.cwd, "sent-elsewhere.ts"), "export const r = 9;\n");
        await finishThroughProxy(input.mcpUrl, mine.id, "Sent the supervisor's push away.");
      },
      finished,
    ]);

    const pass = await runOnce({ ...work(deevy), session });

    expect(pass.worked[0]?.delivered).toBeUndefined();
    expect(await refsOn(deevy.repo)).not.toContain("refs/heads/deevy/");
    expect(await feedOf(deevy, pass.worked[0].runId)).not.toContain("Pushed");
    expect(deevy.tracker.pulls).toEqual([]);
    const said = (deevy.tracker.comments.get("1") ?? []).map((comment) => comment.body);
    expect(said).toContainEqual(
      expect.stringContaining("could not be delivered: the remote does not have deevy/"),
    );
  });
});

/**
 * The clone is the session's, `.git` and all: its configuration and its hooks
 * are whatever the session wrote, and git runs what they name as whoever runs
 * git. The supervisor runs git in it too — the delivery, and every reading of
 * what moved — and as root that would be the session's code running as root.
 */
describe("what a session plants in its clone", () => {
  async function planting(user: { uid: number; gid: number }) {
    const deevy = await assigned();
    // Somewhere the planted command can write whoever it runs as, outside the
    // clone so the clone's removal does not take the evidence with it.
    const evidence = await mkdtemp(join(tmpdir(), "deevy-planted-"));
    scratch.push(evidence);
    await chmod(evidence, 0o777);
    const log = join(evidence, "ran");
    await writeFile(log, "");
    await chmod(log, 0o666);
    const command = join(evidence, "planted");
    await writeFile(
      command,
      [
        "#!/bin/sh",
        "{",
        '  printf "%s uid=%s" "$1" "$(id -u)"',
        '  [ -n "$DEEVY_AGENT_KEY" ] && printf " key"',
        '  ps -o args= -p "$PPID" 2>/dev/null | grep -q Authorization && printf " token"',
        "  echo",
        `} >> "${log}"`,
        '[ "$1" = filter ] && exec cat',
        "exit 0",
        "",
      ].join("\n"),
    );
    await chmod(command, 0o755);
    const fsmonitor = join(evidence, "fsmonitor");
    await writeFile(fsmonitor, `#!/bin/sh\nexec "${command}" fsmonitor\n`);
    await chmod(fsmonitor, 0o755);

    // The supervisor's own environment holds the Agent's key in production;
    // so does this one, for as long as the test runs.
    const had = process.env.DEEVY_AGENT_KEY;
    process.env.DEEVY_AGENT_KEY = "deevy_sk_the_supervisors_own";
    closers.push(() => {
      if (had === undefined) delete process.env.DEEVY_AGENT_KEY;
      else process.env.DEEVY_AGENT_KEY = had;
    });

    const session = scripted([
      async (input) => {
        const [mine] = await deevy.deevy.runs("pending");
        // Everything here as the session's user, as a real session is: git
        // refuses a clone somebody else owns, root included, and what the
        // session writes is its own.
        const git = (args: string[]) =>
          run("git", ["-C", input.cwd, ...args], {
            uid: user.uid,
            gid: user.gid,
            env: { ...process.env, HOME: tmpdir() },
          });
        const write = async (path: string, body: string, mode = 0o644) => {
          await writeFile(path, body);
          await chmod(path, mode);
          await chown(path, user.uid, user.gid);
        };
        await write(join(input.cwd, "work.ts"), "export const t = 7;\n");
        // A filter every file goes through, an fsmonitor, and a hook on
        // every step the delivery takes.
        await write(join(input.cwd, ".gitattributes"), "* filter=planted\n");
        await git(["config", "filter.planted.clean", `"${command}" filter`]);
        await git(["config", "core.fsmonitor", fsmonitor]);
        for (const hook of [
          "pre-commit",
          "post-commit",
          "post-checkout",
          "pre-push",
          "reference-transaction",
        ]) {
          await write(
            join(input.cwd, ".git", "hooks", hook),
            `#!/bin/sh\nexec "${command}" hook\n`,
            0o755,
          );
        }
        // Finished through the proxy, so the delivery runs while the session
        // is still alive, which is the case that made this urgent.
        await finishThroughProxy(input.mcpUrl, mine.id, "Planted, and finished.");
      },
      finished,
    ]);

    const pass = await runOnce({
      ...work(deevy),
      workspace: (options: Parameters<typeof openWorkspace>[0]) =>
        openWorkspace({ ...options, user }),
      session,
    });

    const branch = pass.worked[0]?.delivered?.branch ?? "";
    expect(branch.startsWith("deevy/")).toBe(true);
    expect(await refsOn(deevy.repo)).toContain(`refs/heads/${branch}`);
    expect(await feedOf(deevy, pass.worked[0].runId)).toContain(`Pushed refs/heads/${branch} at `);

    const ran = (await readFile(log, "utf8")).split("\n").filter(Boolean);
    // The hooks and the fsmonitor never ran at all.
    expect(ran.filter((line) => !line.startsWith("filter "))).toEqual([]);
    // A filter cannot be turned off without breaking a repository that needs
    // one, so it ran, and only ever as the session: its user, and nothing of
    // the supervisor's — not its key, not a credential in git's command line.
    expect(ran.length).toBeGreaterThan(0);
    expect([...new Set(ran)]).toEqual([`filter uid=${String(user.uid)}`]);
  }

  it("runs only as the session, with nothing of the supervisor's", async () => {
    // This process's own ids: anybody may be themselves, so the path that
    // becomes the session's user is the one taken.
    await planting({ uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 });
  });

  // Where the supervisor is root, which is the image, and where a test can ask
  // for somebody else: the planted command must never run as uid 0.
  it.runIf(process.getuid?.() === 0)("never runs as root where the runtime is root", async () => {
    await planting({ uid: 10002, gid: 10002 });
  });
});
