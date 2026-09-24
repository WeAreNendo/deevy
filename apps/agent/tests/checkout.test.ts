import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { bareRepo, instance } from "./helpers.ts";

const closers: Array<() => void> = [];
const scratch: string[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) close();
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

/**
 * The three calls the supervisor makes that the model never does (ADR-0024).
 *
 * A Run's repository, the branch it works on and the credential to clone with
 * all come from deevy, because deevy is what holds the Socket. The runtime
 * asks over HTTP and keeps the answer to itself: none of this is a tool, and
 * `runs.checkout` deliberately is not one at all (ADR-0014).
 */
describe("the checkout deevy issues", () => {
  it("names the repository, the base branch, and the branch this Run works on", async () => {
    const repo = await bareRepo();
    scratch.push(repo.dir);
    const it = await instance({ repo: repo.path });
    closers.push(it.close);
    await it.assign("Give the runtime a health endpoint");
    const [run] = await it.deevy.runs("pending");

    const checkout = await it.deevy.checkout(run.id);

    expect(checkout).toMatchObject({
      cloneUrl: repo.path,
      baseBranch: "main",
      username: "x-access-token",
      token: "tracker-token",
    });
    // deevy names the branch so two attempts at one record cannot collide, and
    // so the runtime and the pull request agree on what to call it.
    expect(checkout?.headBranch).toContain(run.id.replace("run_", "").slice(0, 8));
    expect(checkout?.headBranch.startsWith("deevy/acme-deevy-")).toBe(true);
  });

  it("says a credential was issued, and never what it was", async () => {
    const repo = await bareRepo();
    scratch.push(repo.dir);
    const it = await instance({ repo: repo.path });
    closers.push(it.close);
    await it.assign();
    const [run] = await it.deevy.runs("pending");

    await it.deevy.checkout(run.id);

    const events = await it.asAda.events.list({ limit: 50 });
    const issued = events.events.find((event) => event.kind === "run.checkout_issued");
    expect(issued).toBeDefined();
    expect(JSON.stringify(issued)).not.toContain("tracker-token");
  });

  it("is nothing at all for a Project with no repository, which is not a failure", async () => {
    const it = await instance();
    closers.push(it.close);
    await it.assign();
    const [run] = await it.deevy.runs("pending");

    expect(await it.deevy.checkout(run.id)).toBeNull();
  });
});

describe("the pull request deevy opens", () => {
  it("goes through the Socket, and is attached to the Run that produced it", async () => {
    const repo = await bareRepo();
    scratch.push(repo.dir);
    const it = await instance({ repo: repo.path });
    closers.push(it.close);
    const issue = await it.assign("Give the runtime a health endpoint");
    const [run] = await it.deevy.runs("pending");
    const checkout = await it.deevy.checkout(run.id);

    const opened = await it.deevy.openPull({
      runId: run.id,
      head: checkout?.headBranch ?? "",
      summary: "Added a health endpoint and a smoke for it",
    });

    expect(opened.url).toContain("/pull/1");
    expect(it.tracker.pulls[0]).toMatchObject({
      head: checkout?.headBranch,
      base: "main",
      title: expect.stringContaining("Added a health endpoint"),
    });
    // deevy attaches it, so the runtime does not: one Link, carrying the
    // attempt that produced it.
    const links = await it.asAda.links.list({ issue: issue.url });
    expect(links.links).toMatchObject([{ kind: "pull_request", runId: run.id }]);
  });
});

describe("what a Human decided about the Gate a Run stopped at", () => {
  it("is awaiting until somebody rules, and then says which way and why", async () => {
    const it = await instance();
    closers.push(it.close);
    await it.assign();
    const [run] = await it.deevy.runs("pending");
    await it.asAgent(
      `/runs/${run.id}/gates`,
      JSON.stringify({
        checkpoint: "plan",
        proposal: "## What I will do\n\nWrite the health endpoint.",
      }),
    );

    expect(await it.deevy.gate(run.id)).toMatchObject({
      status: "awaiting",
      checkpoint: "plan",
    });

    const gates = await it.asAda.gates.list({ runId: run.id });
    await it.asAda.gates.approve({ requestId: gates.gates[0].id, note: "Looks right, build it" });

    expect(await it.deevy.gate(run.id)).toMatchObject({
      status: "approved",
      checkpoint: "plan",
      note: "Looks right, build it",
      decidedByMemberId: it.ada.id,
    });
  });

  it("is nothing at all for a Run that never asked", async () => {
    const it = await instance();
    closers.push(it.close);
    await it.assign();
    const [run] = await it.deevy.runs("pending");

    expect(await it.deevy.gate(run.id)).toBeNull();
  });
});
