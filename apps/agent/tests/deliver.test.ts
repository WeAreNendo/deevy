import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { deliver } from "../src/deliver.ts";
import { forgeFor, githubForge, githubSlug, type Forge, type PullRequest } from "../src/forge.ts";
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

function stubForge(): Forge & { opened: unknown[] } {
  const opened: unknown[] = [];
  return {
    opened,
    open: (draft) => {
      opened.push(draft);
      return Promise.resolve<PullRequest>({
        url: "https://github.com/owner/repo/pull/7",
        number: 7,
      });
    },
  };
}

const author = { name: "Planner", email: "planner@deevy.test" };

describe("what a Run delivers", () => {
  it("is a branch named after the attempt, a commit, a push and a pull request", async () => {
    const repo = await remote();
    const workspace = await openWorkspace({ runId: "run-abcdef12-3456", repo });
    scratch.push(workspace.cwd);
    await writeFile(join(workspace.cwd, "answer.txt"), "42\n");
    const forge = stubForge();

    const delivered = await deliver({
      workspace,
      forge,
      issueKey: "acme/deevy#42",
      runId: "run-abcdef12-3456",
      author,
    });

    // The key is the tracker's, and the Run's id is what tells two attempts
    // apart. The shape of the name moves to the core with `runs.checkout`
    // (docs/plans/sockets.md, slice 6), so what is asserted is what it is for.
    const branch = delivered?.branch ?? "";
    expect(branch.startsWith("deevy/")).toBe(true);
    expect(branch.endsWith("run-abcd")).toBe(true);
    expect(delivered).toMatchObject({
      pullRequest: { url: "https://github.com/owner/repo/pull/7", number: 7 },
    });
    // On the remote, which is the only place it counts.
    const { stdout } = await run("git", ["-C", repo.url, "branch", "--list"]);
    expect(stdout).toContain(branch);
    expect(forge.opened).toEqual([
      {
        branch,
        base: "main",
        title: "acme/deevy#42: worked by a deevy Agent",
        body: expect.stringContaining("run-abcdef12-3456"),
      },
    ]);
  });

  it("delivers twice on one Run, because a Gate ruling brings it back", async () => {
    // A Run that stops at a Gate and resumes delivers on both passes, from a
    // fresh clone each time. Branching from the base again would be a
    // non-fast-forward push and the second pass's work would never reach the
    // remote (docs/plans/agent-owns-git.md).
    const repo = await remote();
    const forge = stubForge();

    const first = await openWorkspace({ runId: "run-abcdef12", repo });
    scratch.push(first.cwd);
    await writeFile(join(first.cwd, "before-the-gate.ts"), "export const a = 1;\n");
    const one = await deliver({
      workspace: first,
      forge,
      issueKey: "acme/deevy#1",
      runId: "run-abcdef12",
      author,
    });

    const second = await openWorkspace({ runId: "run-abcdef12", repo });
    scratch.push(second.cwd);
    await writeFile(join(second.cwd, "after-the-ruling.ts"), "export const b = 2;\n");
    const two = await deliver({
      workspace: second,
      forge,
      issueKey: "acme/deevy#1",
      runId: "run-abcdef12",
      author,
    });

    expect(two?.branch).toBe(one?.branch);
    const { stdout } = await run("git", ["-C", repo.url, "log", "--format=%s", one?.branch ?? ""]);
    expect(stdout.split("\n").filter(Boolean)).toHaveLength(3);
  });

  it("says what the Agent said, on the pull request and on the commit", async () => {
    const repo = await remote();
    const forge = stubForge();
    const workspace = await openWorkspace({ runId: "run-abcdef12", repo });
    scratch.push(workspace.cwd);
    await writeFile(join(workspace.cwd, "health.ts"), "export const ok = true;\n");

    await deliver({
      workspace,
      forge,
      issueKey: "acme/deevy#1",
      runId: "run-abcdef12",
      author,
      summary: "Added a health endpoint, and a smoke that proves it answers.",
    });

    // What a reviewer opens says what the Agent decided. Its reasoning is in
    // deevy; this is the one line that reaches the code review.
    expect(forge.opened[0]).toMatchObject({
      title: "acme/deevy#1: Added a health endpoint, and a smoke that proves it answers.",
    });
    expect(String((forge.opened[0] as { body: string }).body)).toContain(
      "Added a health endpoint, and a smoke that proves it answers.",
    );
    const { stdout } = await run("git", [
      "-C",
      repo.url,
      "log",
      "-1",
      "--format=%s",
      (forge.opened[0] as { branch: string } | undefined)?.branch ?? "",
    ]);
    expect(stdout.trim()).toBe(
      "acme/deevy#1: Added a health endpoint, and a smoke that proves it answers.",
    );
  });

  it("keeps its own line when the Agent finished without saying anything", async () => {
    const repo = await remote();
    const forge = stubForge();
    const workspace = await openWorkspace({ runId: "run-abcdef12", repo });
    scratch.push(workspace.cwd);
    await writeFile(join(workspace.cwd, "health.ts"), "export const ok = true;\n");

    await deliver({ workspace, forge, issueKey: "acme/deevy#1", runId: "run-abcdef12", author });

    expect(forge.opened[0]).toMatchObject({ title: "acme/deevy#1: worked by a deevy Agent" });
  });

  it("delivers nothing when the session changed nothing", async () => {
    const repo = await remote();
    const workspace = await openWorkspace({ runId: "run-1", repo });
    scratch.push(workspace.cwd);
    const forge = stubForge();

    // An empty pull request is a worse record than none.
    expect(
      await deliver({ workspace, forge, issueKey: "acme/deevy#1", runId: "run-1", author }),
    ).toBeNull();
    expect(forge.opened).toEqual([]);
  });

  it("leaves the base branch exactly where it was", async () => {
    const repo = await remote();
    const before = (await run("git", ["-C", repo.url, "rev-parse", "main"])).stdout.trim();
    const workspace = await openWorkspace({ runId: "run-1", repo });
    scratch.push(workspace.cwd);
    await writeFile(join(workspace.cwd, "answer.txt"), "42\n");

    await deliver({ workspace, forge: null, issueKey: "acme/deevy#1", runId: "run-1", author });

    expect((await run("git", ["-C", repo.url, "rev-parse", "main"])).stdout.trim()).toBe(before);
  });

  it("gives two attempts at one Issue two branches", async () => {
    const repo = await remote();
    const branches: string[] = [];
    for (const runId of ["run-aaaaaaaa", "run-bbbbbbbb"]) {
      const workspace = await openWorkspace({ runId, repo });
      scratch.push(workspace.cwd);
      await writeFile(join(workspace.cwd, `${runId}.txt`), "work\n");
      const delivered = await deliver({ workspace, forge: null, issueKey: "acme/deevy#1", runId, author });
      branches.push(delivered?.branch ?? "");
    }

    expect(new Set(branches).size).toBe(2);
  });

  it("pushes a branch and opens nothing when the repository has no forge", async () => {
    const repo = await remote();
    const workspace = await openWorkspace({ runId: "run-1", repo });
    scratch.push(workspace.cwd);
    await writeFile(join(workspace.cwd, "answer.txt"), "42\n");

    const delivered = await deliver({
      workspace,
      forge: null,
      issueKey: "acme/deevy#1",
      runId: "run-1",
      author,
    });

    expect(delivered?.pullRequest).toBeNull();
    expect(delivered?.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("the forge", () => {
  it("reads a GitHub repository out of a clone URL, and refuses anything else", () => {
    expect(githubSlug("https://github.com/deevy/deevy.git")).toBe("deevy/deevy");
    expect(githubSlug("https://github.com/deevy/deevy")).toBe("deevy/deevy");
    expect(githubSlug("https://gitlab.com/deevy/deevy.git")).toBeNull();
    expect(githubSlug("/tmp/a-bare-repository")).toBeNull();
  });

  it("is absent without a credential or a GitHub repository, so a branch still ships", () => {
    const github = { url: "https://github.com/a/b.git", token: "ghp_x", baseBranch: "main" };

    expect(forgeFor({ repo: null })).toBeNull();
    expect(forgeFor({ repo: { url: github.url, baseBranch: "main" } })).toBeNull();
    expect(forgeFor({ repo: { url: "/tmp/bare", token: "ghp_x", baseBranch: "main" } })).toBeNull();
    expect(forgeFor({ repo: github })).not.toBeNull();
  });

  it("takes an API root and a slug the clone URL cannot supply", async () => {
    const seen: string[] = [];
    const forge = forgeFor(
      {
        repo: { url: "/tmp/a-bare-repository", token: "ghp_x", baseBranch: "main" },
        githubApi: "http://localhost:9999/api/",
        githubRepo: "owner/repo",
      },
      async (url) => {
        seen.push(new Request(url).url);
        return new Response(JSON.stringify({ html_url: "http://localhost/pull/1", number: 1 }));
      },
    );

    // A repository on disk has neither host nor slug, which is what an
    // acceptance run against a bare repository needs (docs/m4-acceptance.md).
    expect(forge).not.toBeNull();
    await forge?.open({ branch: "b", base: "main", title: "t", body: "y" });
    expect(seen).toEqual(["http://localhost:9999/api/repos/owner/repo/pulls"]);
  });

  it("asks GitHub for a pull request the way GitHub documents it", async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const forge = githubForge({
      slug: "owner/repo",
      token: "ghp_x",
      fetch: async (url, init) => {
        // Normalised the way the platform would, so the test reads what a
        // server would receive rather than what was passed in.
        const request = new Request(url, init);
        seen.push({ url: request.url, body: await request.text() });
        return new Response(
          JSON.stringify({ html_url: "https://github.com/owner/repo/pull/3", number: 3 }),
        );
      },
    });

    expect(await forge.open({ branch: "b", base: "main", title: "t", body: "y" })).toEqual({
      url: "https://github.com/owner/repo/pull/3",
      number: 3,
    });
    expect(seen[0].url).toBe("https://api.github.com/repos/owner/repo/pulls");
    expect(JSON.parse(seen[0].body)).toEqual({
      head: "b",
      base: "main",
      title: "t",
      body: "y",
    });
  });

  it("says what GitHub said when it refuses", async () => {
    const forge = githubForge({
      slug: "owner/repo",
      token: "ghp_x",
      fetch: async () => new Response('{"message":"Validation Failed"}', { status: 422 }),
    });

    await expect(forge.open({ branch: "b", base: "main", title: "t", body: "y" })).rejects.toThrow(
      "Validation Failed",
    );
  });
});
