/**
 * The Sockets milestone's acceptance walk, executed rather than described
 * (docs/sockets-acceptance.md).
 *
 * Everything is on this machine: deevy on Node and on workerd, a sign-in stub,
 * a bare git repository as the remote, and a tracker deevy talks to exactly as
 * it will talk to GitHub — the Socket provider that is not a tool
 * (packages/sockets/src/stub). No Cloudflare account, no OAuth App, no GitHub
 * App, no tunnel, no repository on the internet.
 *
 * What is real: the supervisor. Discovery, the claim, the checkout, the
 * envelope, the Gate round trip, the branch, the push, the pull request and
 * what deevy says back in the tracker are `apps/agent/src` and
 * `packages/core` doing their own jobs against a deevy over a socket.
 * What is scripted is the model's judgement — and the scripted session writes
 * over `/mcp` with the Agent's key, exactly as Claude would, so the surface is
 * the real one even though the reasoning is not.
 *
 * The one thing this cannot stand in for is Claude itself. That is
 * `tests/live.test.ts`, which is skipped unless DEEVY_AGENT_LIVE=1 and can be
 * pointed at either deployment this script starts.
 *
 *   vp run agent#acceptance              both deployments
 *   vp run agent#acceptance -- --url ... one that is already running
 */
import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createDeevy } from "../src/deevy.ts";
import { openGitProxy } from "../src/git-proxy.ts";
import { openProxy } from "../src/proxy.ts";
import type { SessionEvent } from "../src/session.ts";
import { deevyToolNames } from "../src/tools.ts";
import { runOnce } from "../src/work.ts";
import { openWorkspace, type RepoConfig } from "../src/workspace.ts";
import { adminEmail, startNode, startWorkers, type Deployment } from "./boot.ts";

const git = promisify(execFile);
const mcpProtocolVersion = "2026-07-28";
const mcpEnvelope = {
  "io.modelcontextprotocol/protocolVersion": mcpProtocolVersion,
  "io.modelcontextprotocol/clientCapabilities": { elicitation: { url: {} } },
  "io.modelcontextprotocol/clientInfo": { name: "deevy-acceptance", version: "0" },
};

/** The container the stubbed tracker offers, and the Project bound to it. */
const CONTAINER = "acme/deevy";
/** What the stub signs its deliveries with, chosen here and given to deevy at connect. */
const webhookSecret = "acceptance-webhook-secret";
const secondEmail = "grace@example.com";

let failures = 0;

/** What one scripted session spent, as Claude Code would count it: a thousand in, and a cost. */
function spent(costUsd: number) {
  return {
    models: [
      {
        model: "claude-haiku-4-5",
        inputTokens: 1_000,
        outputTokens: 200,
        cacheReadTokens: 20_000,
        cacheWriteTokens: 1_500,
        costUsd,
        costBasis: "list" as const,
      },
    ],
  };
}

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

/** Waits for something a background pass produces, nudging the deployment as it goes. */
async function until<T>(
  deployment: Pick<Deployment, "tick">,
  what: string,
  read: () => Promise<T | null>,
  seconds = 20,
): Promise<T> {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    await deployment.tick();
    const found = await read();
    if (found !== null) return found;
    if (Date.now() > deadline) throw new Error(`${what} did not happen in ${String(seconds)}s`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// ---------------------------------------------------------------- the Human

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** One Human signing in with GitHub, as the browser would do it. */
async function signIn(origin: string, email: string): Promise<string> {
  const started = await fetch(`${origin}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "github", callbackURL: "/" }),
  });
  const text = await started.text();
  const url = (JSON.parse(text) as { url?: string }).url;
  if (!url)
    throw new Error(`no authorization URL: ${String(started.status)} ${text.slice(0, 200)}`);
  const state = new URL(url).searchParams.get("state") ?? "";
  const callback = await fetch(
    `${origin}/api/auth/callback/github?state=${encodeURIComponent(state)}&code=${encodeURIComponent(email)}`,
    { headers: { cookie: cookiesOf(started) }, redirect: "manual" },
  );
  const cookie = cookiesOf(callback);
  if (!cookie) throw new Error(`sign-in refused: ${callback.headers.get("location") ?? ""}`);
  return cookie;
}

/** One oRPC call over the surface the SPA calls, as a Human. */
async function human(
  origin: string,
  procedure: string,
  input: unknown,
  cookie: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${origin}/rpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ json: input }),
  });
  const body = await response.text();
  if (response.status !== 200) {
    throw new Error(`${procedure} was ${String(response.status)}: ${body.slice(0, 300)}`);
  }
  return ((JSON.parse(body) as { json?: unknown }).json ?? {}) as Record<string, unknown>;
}

/** The same, for a call that is meant to be refused: the message is the point. */
async function refused(
  origin: string,
  procedure: string,
  input: unknown,
  cookie: string,
): Promise<string> {
  try {
    await human(origin, procedure, input, cookie);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// -------------------------------------------------------------- the tracker

/**
 * One delivery, signed the way the stub signs one
 * (packages/sockets/src/stub/index.ts).
 *
 * Written out rather than imported, because this script is deevy seen from
 * outside: what it proves is that a signature computed by somebody else over
 * the bytes on the wire is the signature deevy checks.
 */
async function deliver(
  origin: string,
  socketId: string,
  events: unknown[],
  deliveryId: string,
): Promise<Response> {
  const body = JSON.stringify({ events });
  return fetch(`${origin}/hooks/${socketId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stub-event": "events",
      "stub-delivery": deliveryId,
      "stub-signature": createHmac("sha256", webhookSecret).update(body).digest("hex"),
    },
    body,
  });
}

/** A record as the tracker states one, for a delivery that says it changed. */
function stated(
  record: { externalId: string; externalKey: string; url: string; title: string },
  labels: string[],
  minutesOn: number,
): unknown {
  return {
    kind: "issue",
    scopeKey: CONTAINER,
    actor: { login: "ada", id: "stub-user-ada", isBot: false },
    issue: {
      externalId: record.externalId,
      key: record.externalKey,
      url: record.url,
      title: record.title,
      body: "An operator cannot tell whether the runtime is alive.",
      state: "open",
      stateName: "open",
      assignees: [],
      labels,
      parentExternalId: null,
      // Later than deevy's own copy, because an older clock is a reordered
      // delivery and deevy is right to drop it (packages/core/src/issues.ts).
      updatedAt: new Date(Date.now() + minutesOn * 60_000).toISOString(),
    },
  };
}

let comments = 0;

/**
 * A comment on the record that is a Ruling, as a provider's `normalize` reads
 * one (`parseRulingCommand`). The author is the tool's own account id, which
 * for the stub's GitHub is the address the Human signs in with — the id
 * `apps/web/scripts/stub-oauth.js` hands Better Auth.
 */
function rulingComment(
  record: { externalId: string; url: string },
  author: { login: string; id: string },
  body: string,
): unknown {
  comments += 1;
  const [first = ""] = body.split("\n");
  const rejected = first.startsWith("/reject");
  return {
    kind: "ruling",
    scopeKey: CONTAINER,
    issueExternalId: record.externalId,
    comment: {
      externalId: `walk-${String(comments)}`,
      url: `${record.url}#walk-${String(comments)}`,
      body,
      author: { ...author, isBot: false },
      createdAt: new Date().toISOString(),
    },
    decision: rejected ? "rejected" : "approved",
    note: first.replace(/^\/(approve|reject)\s*/, "") || null,
  };
}

/** What deevy has said on the record so far, read from the tracker through deevy. */
async function said(origin: string, issue: string, cookie: string): Promise<string[]> {
  const read = await human(origin, "issues/get", { issue, comments: true }, cookie);
  return ((read.comments as Array<{ body: string }> | null) ?? []).map((one) => one.body);
}

// ---------------------------------------------------------------- the model

/**
 * One tool call the way the model makes it: to the supervisor's loopback proxy,
 * with no credential at all. The proxy adds the Agent's key and refuses a tool
 * the runtime did not grant (src/proxy.ts).
 */
async function tool(
  mcpUrl: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": mcpProtocolVersion,
      "mcp-method": "tools/call",
      "mcp-name": name,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args, _meta: mcpEnvelope },
    }),
  });
  const body = await response.text();
  if (response.status !== 200) {
    throw new Error(`${name} was ${String(response.status)}: ${body.slice(0, 300)}`);
  }
  const answer = JSON.parse(body) as {
    error?: unknown;
    result?: { isError?: boolean; content?: unknown; structuredContent?: unknown };
  };
  if (answer.error) throw new Error(`${name} failed: ${JSON.stringify(answer.error)}`);
  if (answer.result?.isError) {
    throw new Error(`${name} refused: ${JSON.stringify(answer.result.content)}`);
  }
  return (answer.result?.structuredContent ?? {}) as Record<string, unknown>;
}

const ready: SessionEvent = {
  type: "ready",
  tools: [],
  servers: [{ name: "deevy", status: "connected" }],
};

// ------------------------------------------------------------- the outside

/** A bare repository with one commit on `main`, to clone from and push to. */
async function remote(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "deevy-acceptance-repo-"));
  const bare = join(dir, "origin.git");
  const seed = join(dir, "seed");
  await git("git", ["init", "--bare", "--initial-branch", "main", "--quiet", bare]);
  await git("git", ["clone", "--quiet", bare, seed]);
  await git("git", ["-C", seed, "config", "user.email", "seed@deevy.test"]);
  await git("git", ["-C", seed, "config", "user.name", "seed"]);
  await writeFile(join(seed, "README.md"), "# the repository the Agent works in\n");
  await git("git", ["-C", seed, "add", "-A"]);
  await git("git", ["-C", seed, "commit", "--quiet", "-m", "first"]);
  await git("git", ["-C", seed, "push", "--quiet", "origin", "main"]);
  return bare;
}

// ----------------------------------------------------------------- the walk

export async function walk(deployment: Deployment, label: string, repo: string): Promise<string> {
  const { origin } = deployment;
  console.log(`\n${label} — ${origin}`);
  const ada = await signIn(origin, adminEmail);

  // Part 1: what a Human sets up, all of it over the surface the SPA calls.
  // A second Human, because a four-eyes Checkpoint needs somebody who is not
  // the one the work is for (ADR-0020).
  await human(origin, "allowlist/add", { kind: "email_domain", value: "example.com" }, ada);
  const grace = await signIn(origin, secondEmail);
  const graceId = String(
    ((await human(origin, "me/get", {}, grace)).member as { id: string } | undefined)?.id ?? "",
  );

  const socket = await human(
    origin,
    "sockets/connect",
    // Its accounts are the ones deevy signs people in with, as github.com's
    // are: so a Human who signed in with GitHub rules from the tracker with no
    // linking step (ADR-0025).
    {
      provider: "stub",
      name: "Example tracker",
      config: { signInProvider: "github" },
      webhookSecret,
    },
    ada,
  );
  const socketId = String(socket.id);
  check(
    "connecting a tool proves it by asking who deevy is there",
    (socket.identity as { login?: string } | undefined)?.login === "deevy",
    JSON.stringify(socket.identity),
  );

  const project = await human(
    origin,
    "projects/create",
    {
      slug: "deevy",
      name: "deevy",
      tracker: { socketId, scope: { scopeKey: CONTAINER } },
      forge: { socketId, scope: { scopeKey: CONTAINER, baseBranch: "main" } },
    },
    ada,
  );
  await human(
    origin,
    "checkpoints/set",
    {
      projectSlug: "deevy",
      checkpoints: [
        { name: "plan", approvalsRequired: 1 },
        // The one the Human the work is for may not rule on themselves.
        { name: "ship", approvalsRequired: 1, excludeRequester: true },
      ],
    },
    ada,
  );

  const planner = await human(origin, "agents/create", { name: "Planner" }, ada);
  const plannerId = String(planner.id);
  await human(origin, "agents/grants/add", { memberId: plannerId, projectId: project.id }, ada);
  const key = String((planner.key as { key?: string } | undefined)?.key ?? "");

  // Part 2: the work arrives, the way work arrives — as a record in the team's
  // own tracker, which deevy opens through the Socket and then projects.
  const record = (await human(
    origin,
    "issues/create",
    {
      projectSlug: "deevy",
      title: "Give the runtime a health endpoint",
      body: "An operator cannot tell whether the runtime is alive.",
    },
    ada,
  )) as unknown as { externalId: string; externalKey: string; url: string; title: string };
  const issueKey = record.externalKey;

  // And it is labelled for the Planner, which is a delivery and nothing else.
  const labelled = await deliver(
    origin,
    socketId,
    [stated(record, ["agent:planner"], 1)],
    "acceptance-1",
  );
  check("a signed delivery is taken", labelled.status === 200, String(labelled.status));

  const replay = await deliver(
    origin,
    socketId,
    [stated(record, ["agent:planner"], 2)],
    "acceptance-1",
  );
  check("the same delivery twice is one delivery", replay.status === 200);

  const unsigned = await fetch(`${origin}/hooks/${socketId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "stub-event": "events", "stub-delivery": "x" },
    body: JSON.stringify({ events: [] }),
  });
  check("an unsigned delivery is refused", unsigned.status === 401, String(unsigned.status));

  // Everything below is the runtime's own code, against this deployment.
  const config = {
    url: origin,
    key,
    harness: "claude-code",
    pollSeconds: 1,
    runTimeoutSeconds: 120,
    model: "scripted",
    effort: "high" as const,
    maxTurns: 10,
    // No repository here: the Project is bound to one, and deevy answers every
    // Run with the clone URL, the branch and a credential (ADR-0024).
    repo: null,
    listenPort: 0,
    sessionUid: 10002,
    sessionGid: 10002,
  };
  const deevy = createDeevy({ config });
  const proxies: Array<() => Promise<void>> = [];
  const work = {
    deevy,
    // What each session's usage says counted it (docs/plans/run-usage.md).
    harness: "claude-code",
    // Every push in this walk goes through the supervisor's git proxy, which is
    // how the session reaches a remote at all (docs/plans/agent-owns-git.md).
    gitProxy: async (checkout: { cloneUrl: string; token: string }) => {
      const proxy = await openGitProxy({ upstream: checkout.cloneUrl, token: checkout.token });
      proxies.push(() => proxy.close());
      return proxy;
    },
    proxy: (options: { onDenied: (name: string) => Promise<void> }) =>
      openProxy({ url: origin, key, tools: deevyToolNames, ...options }),
    runTimeoutMs: 120_000,
    workspace: (options: { runId: string; repo: RepoConfig | null; originUrl?: string }) =>
      openWorkspace(options),
  };

  check(
    "the runtime is the Agent, and says which Member",
    (await deevy.me()).memberId === plannerId,
  );

  const pending = await deevy.runs("pending");
  check(
    "the label opened exactly one Run, for the Agent it named",
    pending.length === 1 && pending[0]?.issueKey === issueKey,
    JSON.stringify(pending.map((run) => [run.issueKey, run.status])),
  );
  const runId = pending[0]?.id ?? "";

  // Part 3: the first pass. The model reads the record, says what it intends
  // to do, and stops at the Gate.
  let sawInConfig = "";
  const planned = await runOnce({
    ...work,
    session: async function* (input) {
      yield ready;
      // The credential is the supervisor's: there is no tool for it, and the
      // working directory it cloned carries none (ADR-0014, ADR-0019).
      const denied = await tool(input.mcpUrl, "runs_checkout", { runId }).catch((error: unknown) =>
        error instanceof Error ? error.message : String(error),
      );
      check(
        "the proxy refuses the checkout, which is not a tool at all",
        typeof denied === "string" && denied.includes("not available to this session"),
        JSON.stringify(denied),
      );
      sawInConfig = await readFile(join(input.cwd, ".git", "config"), "utf8");

      const read = await tool(input.mcpUrl, "issues_get", { issue: issueKey, comments: true });
      check(
        "the record an Agent reads is the tracker's, and says where to stop",
        JSON.stringify(read.checkpoints) === JSON.stringify(["plan", "ship"]),
        JSON.stringify(read.checkpoints),
      );
      await tool(input.mcpUrl, "runs_post_activity", {
        runId,
        kind: "thought",
        body: "Reading the record before I plan anything",
      });
      await tool(input.mcpUrl, "gates_request", {
        runId,
        checkpoint: "plan",
        proposal: "## What I will do\n\nAdd a health endpoint, and a smoke that proves it answers.",
      });
      yield { type: "done", ok: true, detail: "asked", usage: spent(0.5) };
    },
  });

  check(
    "the Run is taken up and stops at the Gate",
    planned.worked.length === 1 && planned.worked[0]?.status === "awaiting_input",
    JSON.stringify(planned.worked),
  );
  check(
    "nothing is delivered by a Run that only asked",
    planned.worked[0]?.delivered === undefined,
  );
  check(
    "the credential is in no working directory the session can read",
    sawInConfig.includes("127.0.0.1") && !sawInConfig.includes("stub-token"),
    sawInConfig,
  );
  const feed = (await human(origin, "runs/get", { runId }, ada)).activities as Array<{
    kind: string;
    body: string;
  }>;
  check(
    "the refusal is in the Run's feed, in the Agent's name",
    feed.some((one) => one.kind === "error" && one.body.includes("runs_checkout")),
    JSON.stringify(feed.map((one) => [one.kind, one.body])),
  );

  // What deevy says back where the team reads: the Proposal, signed, and the
  // record labelled while it waits (slice 7).
  const mirrored = await until(deployment, "the Gate reaching the tracker", async () => {
    const said = (await human(origin, "issues/get", { issue: issueKey, comments: true }, ada))
      .comments as Array<{ body: string }> | null;
    return said?.find((one) => one.body.includes("## What I will do")) ?? null;
  });
  check(
    "the Proposal is a comment in the tracker, signed with the Agent and the Run",
    mirrored.body.includes("Planner") && mirrored.body.includes(runId),
    mirrored.body,
  );
  /*
   * The label that goes with it — `deevy:awaiting-approval` while the Gate is
   * open, off again when it is ruled — is the same delivery as this comment and
   * is asserted against the tracker's own state in
   * `packages/core/tests/mirror.test.ts`. It cannot be asserted from here: what
   * `issues.get` answers is deevy's projection, and deevy's copy of the labels
   * is whatever the tracker last told it, not what deevy last asked for.
   */

  // A pass that finds a Run waiting on a Human leaves it exactly there.
  const untouched = await runOnce({
    ...work,
    session: async function* () {
      yield ready;
      throw new Error("a Run waiting on a Human is not the runtime's to work");
    },
  });
  check(
    "a Run nobody has ruled on is reported, not worked",
    untouched.worked.length === 0 &&
      untouched.resumed.length === 0 &&
      untouched.waiting.length === 1,
    JSON.stringify(untouched.waiting.map((run) => run.status)),
  );

  // Part 4: the Human rules where they read the Proposal — in the tracker —
  // and the loop carries on (ADR-0025).
  //
  // First somebody deevy cannot place, who is told how to be placed and rules
  // nothing: an account id is proof, a login is not.
  const stranger = await deliver(
    origin,
    socketId,
    [rulingComment(record, { login: "mallory", id: "mallory@example.net" }, "/approve")],
    "acceptance-ruling-1",
  );
  check("a Ruling from the tracker is a delivery like any other", stranger.status === 200);
  const linkReply = await until(
    deployment,
    "the stranger being answered",
    async () => (await said(origin, issueKey, ada)).find((one) => one.includes("@mallory")) ?? null,
  );
  check(
    "an account nobody linked rules nothing, and is told where to link it",
    linkReply.includes("ruled nothing") && linkReply.includes("/settings/identities"),
    linkReply,
  );
  const stillOpen = (await human(origin, "gates/list", { runId }, ada)).gates as Array<{
    status: string;
  }>;
  check(
    "and the Gate is still waiting",
    stillOpen[0]?.status === "open",
    JSON.stringify(stillOpen),
  );

  // Then the admin, from the GitHub account they signed in to deevy with.
  await deliver(
    origin,
    socketId,
    [rulingComment(record, { login: "ada", id: adminEmail }, "/approve Looks right, build it")],
    "acceptance-ruling-2",
  );
  const planRuled = (await human(origin, "gates/list", { runId }, ada)).gates as Array<{
    status: string;
    decisions: Array<{ via: string; memberId: string }>;
  }>;
  check(
    "the admin rules from the tracker with no linking step, and deevy says where it came from",
    planRuled[0]?.status === "approved" && planRuled[0]?.decisions[0]?.via === "socket",
    JSON.stringify(planRuled.map((gate) => [gate.status, gate.decisions])),
  );
  check(
    "the ruling reaches the Agent's inbox",
    (await deevy.unread()).some((one) => one.kind === "run_answered"),
  );

  let resumePrompt = "";
  const built = await runOnce({
    ...work,
    session: async function* (input) {
      resumePrompt = input.prompt;
      yield ready;
      // git is the Agent's: its own branch, its own commit, its own push,
      // through the loopback origin the supervisor put in front of it.
      const inside = (args: string[]) => git("git", ["-C", input.cwd, ...args]);
      await inside(["checkout", "--quiet", "-b", "health-endpoint"]);
      await writeFile(join(input.cwd, "health.ts"), "export const ok = true;\n");
      await inside(["add", "-A"]);
      await inside([
        "-c",
        "user.name=Planner",
        "-c",
        "user.email=planner@deevy.invalid",
        "commit",
        "-qm",
        "Add a health endpoint",
      ]);
      await inside(["push", "--quiet", "origin", "health-endpoint"]);

      const opened = await tool(input.mcpUrl, "pulls_open", {
        runId,
        head: "health-endpoint",
        summary: "Added a health endpoint and a smoke for it",
      });
      await tool(input.mcpUrl, "gates_request", {
        runId,
        checkpoint: "ship",
        proposal: "## What I built\n\nA health endpoint, and a smoke that proves it answers.",
        links: [{ url: String(opened.url), title: "The pull request" }],
      });
      yield { type: "done", ok: true, detail: "built", usage: spent(1.25) };
    },
  });

  check(
    "the ruling hands the Run back, and it stops at the second Gate",
    built.resumed.length === 1 && built.resumed[0]?.status === "awaiting_input",
    JSON.stringify(built.resumed),
  );
  check(
    "the resumed session is told what was decided, and what the Human said",
    resumePrompt.includes("approved the plan Gate") &&
      resumePrompt.includes("Looks right, build it"),
    resumePrompt,
  );

  // Part 5: four eyes. The Human the work is for cannot wave it through.
  const shipGate = (
    (await human(origin, "gates/list", { runId, status: "open" }, ada)).gates as Array<{
      id: string;
    }>
  )[0];
  const refusedSaid = await refused(origin, "gates/approve", { requestId: shipGate?.id }, ada);
  check(
    "the Human the Run is for is refused at a four-eyes Checkpoint",
    refusedSaid.includes("wants somebody other than the Human this Run is for"),
    refusedSaid,
  );
  await deliver(
    origin,
    socketId,
    [rulingComment(record, { login: "ada", id: adminEmail }, "/approve")],
    "acceptance-ruling-3",
  );
  const fourEyes = await until(
    deployment,
    "the requester being answered",
    async () =>
      (await said(origin, issueKey, ada)).find((one) =>
        one.includes("wants somebody other than the Human this Run is for"),
      ) ?? null,
  );
  check(
    "and refused from the tracker too, in the same words",
    fourEyes.startsWith("@ada, that ruled nothing"),
    fourEyes,
  );
  // Somebody else rules, in deevy: both doors lead to the same Ruling.
  await human(origin, "gates/approve", { requestId: shipGate?.id, note: "Ship it" }, grace);
  check("and somebody else can rule on it", graceId !== "");

  const finished = await runOnce({
    ...work,
    session: async function* (input) {
      yield ready;
      await tool(input.mcpUrl, "runs_finish", {
        runId,
        status: "completed",
        summary: "Added a health endpoint and a smoke for it",
      });
      yield { type: "done", ok: true, detail: "finished", usage: spent(0.25) };
    },
  });
  check(
    "the second ruling hands it back again, and it finishes",
    finished.resumed.length === 1 && finished.resumed[0]?.status === "completed",
    JSON.stringify(finished.resumed),
  );

  // Part 6: the evidence, on the remote and on the record.
  const branches = repo ? (await git("git", ["-C", repo, "branch", "--list"])).stdout : "";
  check(
    "the branch the session pushed is on the remote, and main is untouched",
    branches.includes("health-endpoint") && !branches.includes("deevy/"),
    branches.replaceAll("\n", " "),
  );

  const links = (await human(origin, "links/list", { issue: issueKey }, ada)).links as Array<{
    kind: string;
    url: string;
    runId: string | null;
  }>;
  check(
    "one pull request, attributed to the attempt that produced it",
    links.length === 1 && links[0]?.kind === "pull_request" && links[0]?.runId === runId,
    JSON.stringify(links),
  );
  check(
    "and it was opened in the tracker, not by the runtime",
    links[0]?.url.includes(`/${CONTAINER}/pull/`) === true,
    links[0]?.url ?? "",
  );

  const ruled = await until(deployment, "the ruling reaching the tracker", async () => {
    const said = (await human(origin, "issues/get", { issue: issueKey, comments: true }, ada))
      .comments as Array<{ body: string }> | null;
    return said?.find((one) => one.body.includes("Ship it")) ?? null;
  });
  check(
    "the ruling is said back in the tracker too, with the arithmetic",
    ruled.body.includes("1 of 1") || ruled.body.toLowerCase().includes("approved"),
    ruled.body,
  );

  // What the Run spent: three sessions, each reported by the supervisor as it
  // ended, and added up by deevy (docs/plans/run-usage.md).
  const spentRun = (await human(origin, "runs/get", { runId }, ada)).usage as {
    inputTokens: number;
    cacheReadTokens: number;
    costUsd: number | null;
    reports: number;
    models: Array<{ harness: string; model: string | null }>;
  };
  check(
    "each session's usage reached the Run, added up and named by its harness",
    spentRun.reports === 3 &&
      spentRun.inputTokens === 3_000 &&
      spentRun.cacheReadTokens === 60_000 &&
      spentRun.costUsd === 2 &&
      spentRun.models.length === 1 &&
      spentRun.models[0]?.harness === "claude-code" &&
      spentRun.models[0]?.model === "claude-haiku-4-5",
    JSON.stringify(spentRun),
  );

  // Part 7: what the record has to say.
  const all = (await human(origin, "events/list", { limit: 100 }, ada)).events as Array<{
    kind: string;
    actorMemberId: string | null;
  }>;
  // From the trigger onward: everything before it is the Human setting up.
  const events = all.slice(all.findIndex((event) => event.kind === "run.started"));
  const story = events.map((event) => event.kind).join(" ");
  console.log(`  —   ${story}`);
  check(
    "the Event log tells the story of the Run from the label to the finish",
    // Each session ends by reporting what it spent: `run.usage_reported` after
    // the plan, after the build, and after the finish.
    story ===
      "run.started run.checkout_issued run.activity run.activity gate.requested " +
        "run.awaiting_input run.usage_reported gate.ruling_refused identity.linked " +
        "gate.approved run.answered run.checkout_issued issue.link_added " +
        "run.pull_request_opened gate.requested run.awaiting_input run.usage_reported " +
        "run.activity comment.created gate.ruling_refused gate.approved run.answered " +
        "run.checkout_issued run.completed run.usage_reported",
    story,
  );
  // These are a Human's or the tracker's, each for the right reason:
  // `run.started` records the Member whose label routed the work,
  // `gate.approved` the Ruling, `run.answered` that Ruling reaching the Run.
  // Everything else is the Agent acting as itself.
  const humans = new Set([
    "run.started",
    "gate.approved",
    "gate.rejected",
    "run.answered",
    // The tracker's, not the Agent's: a comment deevy could not count, and an
    // account it came to know. Neither is anything the Agent did.
    "gate.ruling_refused",
    "identity.linked",
  ]);
  check(
    "the Agent is the actor throughout, and the Human exactly one hop away",
    events.every((event) =>
      humans.has(event.kind)
        ? event.actorMemberId !== plannerId
        : event.actorMemberId === plannerId,
    ),
    JSON.stringify(events.map((event) => [event.kind, event.actorMemberId === plannerId])),
  );

  for (const close of proxies) await close();
  return story;
}

async function main(): Promise<void> {
  const given = process.argv.indexOf("--url");
  if (given !== -1) {
    // An instance somebody else started names its own containers, so the
    // repository behind it is theirs to say.
    await walk(
      {
        name: "given",
        origin: process.argv[given + 1] ?? "",
        tick: () => Promise.resolve(),
        stop: () => undefined,
      },
      "an instance that is already running",
      process.env.DEEVY_ACCEPTANCE_REPO ?? "",
    );
  } else {
    // Both deployments, from one codebase, and the runtime cannot tell them
    // apart: that is the claim ADR-0006 makes and this is what checks it.
    const stories: Record<string, string> = {};
    for (const start of [startNode, startWorkers]) {
      let deployment: Deployment | null = null;
      // A repository each: the walk pushes the same branch on both, and a
      // shared remote would make the second push a non-fast-forward.
      const repo = await remote();
      try {
        deployment = await start({ containers: `${CONTAINER}=${repo}` });
        stories[deployment.name] = await walk(deployment, `deevy on ${deployment.name}`, repo);
      } finally {
        deployment?.stop();
      }
    }
    console.log("");
    check(
      "the same walk leaves the same Event log on both deployments",
      stories.node !== undefined && stories.node === stories.workers,
      `node:    ${stories.node ?? "(none)"}\nworkers: ${stories.workers ?? "(none)"}`,
    );
  }
  console.log(
    failures === 0
      ? "\nacceptance: every check passed"
      : `\nacceptance: ${String(failures)} failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
