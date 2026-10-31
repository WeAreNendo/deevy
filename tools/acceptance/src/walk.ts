/**
 * deevy's acceptance walk, executed rather than described (docs/acceptance.md).
 *
 * Everything is on this machine: deevy on Node and on workerd, a sign-in stub,
 * a bare git repository as the remote, and a tracker deevy talks to exactly as
 * it will talk to GitHub — the Socket provider that is not a tool
 * (packages/sockets/src/stub). No Cloudflare account, no OAuth App, no GitHub
 * App, no tunnel, no repository on the internet.
 *
 * What is real is deevy: the Human's surface, the hooks a tracker delivers to,
 * `/mcp` and `/api` as an Agent reaches them with its key, the Gates, the
 * Rulings from the tracker and what deevy says back there. What is scripted is
 * whatever runs the Agent. deevy runs no Agent and manages no access
 * (docs/plans/simplify.md), so the scripted Agent does what any harness does:
 * it finds its work in its inbox, calls the tools with its own key, clones and
 * pushes with its own git, and attaches the pull request it opened.
 *
 *   vp run acceptance#walk              every deployment
 *   vp run acceptance#walk -- --url ... one that is already running
 */
import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  adminEmail,
  startHosted,
  startNode,
  startWorkers,
  type Deployment,
  type StartOptions,
} from "./boot.ts";

const git = promisify(execFile);
const mcpProtocolVersion = "2026-07-28";
const mcpEnvelope = {
  "io.modelcontextprotocol/protocolVersion": mcpProtocolVersion,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "deevy-acceptance", version: "0" },
};

/** The container the stubbed tracker offers, and the Project bound to it. */
const CONTAINER = "acme/deevy";
/** What the stub signs its deliveries with, chosen here and given to deevy at connect. */
const webhookSecret = "acceptance-webhook-secret";
const secondEmail = "grace@example.com";

let failures = 0;

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

/**
 * One Human signing in with GitHub, as the browser would do it.
 *
 * The provider sends the browser to whatever callback the authorization URL
 * names: this deevy's own, or a sign-in relay's when it signs in through one
 * (ADR-0030), as every hosted Workspace does. The relay sets nothing and only
 * sends the browser on to the deevy that started the sign-in, so its redirects
 * are followed, with the browser's cookie, until one sets the session.
 */
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
  const authorization = new URL(url);
  const callback = new URL(
    authorization.searchParams.get("redirect_uri") ?? `${origin}/api/auth/callback/github`,
  );
  callback.searchParams.set("state", authorization.searchParams.get("state") ?? "");
  callback.searchParams.set("code", email);
  const browser = cookiesOf(started);
  let answered = await fetch(callback, { headers: { cookie: browser }, redirect: "manual" });
  for (let hops = 0; hops < 3 && !cookiesOf(answered); hops++) {
    const location = answered.headers.get("location");
    if (!location) break;
    answered = await fetch(new URL(location, callback), {
      headers: { cookie: browser },
      redirect: "manual",
    });
  }
  const cookie = cookiesOf(answered);
  if (!cookie) throw new Error(`sign-in refused: ${answered.headers.get("location") ?? ""}`);
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
    // What the SPA's browser says about its page: a write the session cookie
    // signed in is taken only from deevy's own (packages/core/src/app.ts).
    headers: {
      "content-type": "application/json",
      cookie,
      origin,
      "sec-fetch-site": "same-origin",
    },
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
      body: "An operator cannot tell whether the service is alive.",
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

/**
 * What deevy has said on the record so far, read where it said it: the stubbed
 * tracker's own comments, through the window a stubbed deployment opens on it
 * (`/dev/tracker`). deevy keeps no copy of a record's conversation to read
 * back (docs/plans/simplify.md, slice 4).
 */
async function said(origin: string, record: { externalId: string }): Promise<string[]> {
  const response = await fetch(`${origin}/dev/tracker`);
  if (!response.ok) throw new Error(`/dev/tracker: ${String(response.status)}`);
  const view = (await response.json()) as {
    containers: Array<{ scopeKey: string; comments: Record<string, Array<{ body: string }>> }>;
  };
  const container = view.containers.find((one) => one.scopeKey === CONTAINER);
  return (container?.comments[record.externalId] ?? []).map((one) => one.body);
}

// ---------------------------------------------------------------- the Agent

/**
 * The Agent as any harness runs it: its key, deevy's URL, and nothing deevy
 * hands it besides. Its tools are `/mcp` with the key as a bearer token, and
 * what a loop wants rather than a model — marking its inbox read — is the same
 * operation over `/api` (apps/docs/content/agents/your-own-harness.md).
 */
function agentAt(origin: string, key: string) {
  const authorization = `Bearer ${key}`;
  return {
    async tool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
      const response = await fetch(`${origin}/mcp`, {
        method: "POST",
        headers: {
          authorization,
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
    },

    /** What is new in its inbox, marked read once it has been taken. */
    async unread(): Promise<Array<{ kind: string; issueKey: string | null }>> {
      const page = await this.tool("inbox_list", { unreadOnly: true });
      const rows = (page.notifications ?? []) as Array<{
        id: string;
        kind: string;
        issue: { externalKey: string } | null;
      }>;
      if (rows.length > 0) {
        const read = await fetch(`${origin}/api/inbox/read`, {
          method: "POST",
          headers: { authorization, "content-type": "application/json" },
          body: JSON.stringify({ ids: rows.map((row) => row.id) }),
        });
        if (read.status !== 200) throw new Error(`inbox/read was ${String(read.status)}`);
        // Every row taken is a row marked, or a later read would find this
        // one again and pass for something new.
        const marked = ((await read.json()) as { read?: number }).read;
        if (marked !== rows.length) {
          throw new Error(`inbox/read marked ${String(marked)} of ${String(rows.length)}`);
        }
      }
      return rows.map((row) => ({ kind: row.kind, issueKey: row.issue?.externalKey ?? null }));
    },
  };
}

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

  // Bound to the tracker alone: the code is the Agent's to reach, with access
  // its operator gave it, and deevy is told of a pull request as a Link.
  const project = await human(
    origin,
    "projects/create",
    { slug: "deevy", name: "deevy", tracker: { socketId, scope: { scopeKey: CONTAINER } } },
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
  const agent = agentAt(origin, String((planner.key as { key?: string } | undefined)?.key ?? ""));

  // Part 2: the work arrives, the way work arrives — as a record somebody
  // opened in the team's own tracker, labelled for the Planner. deevy opens no
  // record (docs/plans/simplify.md, slice 4): it hears of this one in a
  // delivery, and that is all it needs.
  const record = {
    externalId: "1",
    externalKey: `${CONTAINER}#1`,
    url: `https://stub.invalid/${CONTAINER}/issues/1`,
    title: "Give the service a health endpoint",
  };
  const issueKey = record.externalKey;

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

  // Part 3: the Agent finds its work where any harness finds it, reads the
  // record, says what it intends to do, and stops at the Gate.
  const assigned = await agent.unread();
  check(
    "the label puts the record in the Agent's inbox",
    assigned.some((one) => one.kind === "assignment" && one.issueKey === issueKey),
    JSON.stringify(assigned),
  );
  const pending = (await agent.tool("runs_list", { issue: issueKey })).runs as Array<{
    id: string;
    status: string;
  }>;
  check(
    "and opened exactly one Run, waiting for it",
    pending.length === 1 && pending[0]?.status === "pending",
    JSON.stringify(pending),
  );
  const runId = pending[0]?.id ?? "";

  const read = await agent.tool("issues_get", { issue: issueKey });
  check(
    "the record an Agent reads is the tracker's, and says where to stop",
    JSON.stringify(read.checkpoints) === JSON.stringify(["plan", "ship"]),
    JSON.stringify(read.checkpoints),
  );
  await agent.tool("runs_post_activity", {
    runId,
    kind: "thought",
    body: "Reading the record before I plan anything",
  });
  const plan = await agent.tool("gates_request", {
    runId,
    checkpoint: "plan",
    proposal: "## What I will do\n\nAdd a health endpoint, and a smoke that proves it answers.",
  });
  check(
    "asking at a Checkpoint stops the Run at its Gate",
    plan.status === "open" && (await agent.tool("runs_get", { runId })).status === "awaiting_input",
    JSON.stringify(plan.status),
  );

  // What deevy says back where the team reads: the Proposal, signed.
  const mirrored = await until(deployment, "the Gate reaching the tracker", async () => {
    return (await said(origin, record)).find((one) => one.includes("## What I will do")) ?? null;
  });
  check(
    "the Proposal is a comment in the tracker, signed with the Agent and the Run",
    mirrored.includes("Planner") && mirrored.includes(runId),
    mirrored,
  );

  // A Run waiting on a Human is waiting, whatever the sweeps do meanwhile.
  await deployment.tick();
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  check(
    "a Run nobody has ruled on stays at its Gate",
    (await agent.tool("runs_get", { runId })).status === "awaiting_input",
  );

  // Part 4: the Human rules where they read the Proposal — in the tracker —
  // and the Agent carries on (ADR-0025).
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
    async () => (await said(origin, record)).find((one) => one.includes("@mallory")) ?? null,
  );
  check(
    "an account nobody linked rules nothing, and is told where to link it",
    linkReply.includes("ruled nothing") && linkReply.includes("/settings/identities"),
    linkReply,
  );
  const stillOpen = await agent.tool("gates_get", { requestId: plan.id });
  check("and the Gate is still waiting", stillOpen.status === "open", JSON.stringify(stillOpen));

  // Then the admin, from the GitHub account they signed in to deevy with.
  await deliver(
    origin,
    socketId,
    [rulingComment(record, { login: "ada", id: adminEmail }, "/approve Looks right, build it")],
    "acceptance-ruling-2",
  );
  const planRuled = (await human(origin, "gates/list", { runId }, ada)).gates as Array<{
    status: string;
    decisions: Array<{ via: string }>;
  }>;
  check(
    "the admin rules from the tracker with no linking step, and deevy says where it came from",
    planRuled[0]?.status === "approved" && planRuled[0]?.decisions[0]?.via === "socket",
    JSON.stringify(planRuled.map((gate) => [gate.status, gate.decisions])),
  );

  check(
    "the Ruling reaches the Agent's inbox",
    (await agent.unread()).some((one) => one.kind === "run_answered" && one.issueKey === issueKey),
  );
  check(
    "and puts its Run back to work",
    (await agent.tool("runs_get", { runId })).status === "active",
  );
  const planned = (await agent.tool("gates_get", { requestId: plan.id })) as {
    status: string;
    decisions: Array<{ note: string | null }>;
  };
  check(
    "and the Agent reads what was decided, and what the Human said, from the Gate",
    planned.status === "approved" &&
      planned.decisions.some((one) => one.note === "Looks right, build it"),
    JSON.stringify(planned.decisions),
  );

  // git is the Agent's: its own clone, with access its operator gave it, its
  // own branch, its own commit, its own push. deevy is not in the way of any
  // of it, and is told about the pull request when there is one.
  const checkout = await mkdtemp(join(tmpdir(), "deevy-acceptance-checkout-"));
  const inside = (args: string[]) => git("git", ["-C", checkout, ...args]);
  await git("git", ["clone", "--quiet", repo, checkout]);
  await inside(["checkout", "--quiet", "-b", "health-endpoint"]);
  await writeFile(join(checkout, "health.ts"), "export const ok = true;\n");
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

  // The pull request the Agent opened in the tool its code lives in, which
  // the stub only names: deevy's part is the Link.
  const pullRequest = `https://stub.invalid/${CONTAINER}/pull/1`;
  await agent.tool("links_add", {
    issue: issueKey,
    url: pullRequest,
    title: "The pull request",
    kind: "pull_request",
    runId,
  });
  const ship = await agent.tool("gates_request", {
    runId,
    checkpoint: "ship",
    proposal: "## What I built\n\nA health endpoint, and a smoke that proves it answers.",
    links: [{ url: pullRequest, title: "The pull request" }],
  });
  check(
    "the Agent builds, and stops at the second Gate",
    ship.status === "open" && (await agent.tool("runs_get", { runId })).status === "awaiting_input",
    JSON.stringify(ship.status),
  );

  // Part 5: four eyes. The Human the work is for cannot wave it through.
  const refusedSaid = await refused(origin, "gates/approve", { requestId: ship.id }, ada);
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
      (await said(origin, record)).find((one) =>
        one.includes("wants somebody other than the Human this Run is for"),
      ) ?? null,
  );
  check(
    "and refused from the tracker too, in the same words",
    fourEyes.startsWith("@ada, that ruled nothing"),
    fourEyes,
  );
  // Somebody else rules, in deevy: both doors lead to the same Ruling.
  await human(origin, "gates/approve", { requestId: ship.id, note: "Ship it" }, grace);
  const shipped = (await agent.tool("gates_get", { requestId: ship.id })) as {
    status: string;
    decisions: Array<{ memberId: string; via: string }>;
  };
  check(
    "and somebody else rules on it, in deevy",
    graceId !== "" &&
      shipped.status === "approved" &&
      shipped.decisions.some((one) => one.memberId === graceId && one.via === "web"),
    JSON.stringify(shipped.decisions),
  );

  check(
    "the second Ruling reaches the Agent's inbox too",
    (await agent.unread()).some((one) => one.kind === "run_answered" && one.issueKey === issueKey),
  );
  check(
    "and puts its Run back to work again",
    (await agent.tool("runs_get", { runId })).status === "active",
  );
  await agent.tool("runs_finish", {
    runId,
    status: "completed",
    summary: "Added a health endpoint and a smoke for it",
  });
  check(
    "and the Agent finishes its Run",
    (await agent.tool("runs_get", { runId })).status === "completed",
  );

  // Part 6: the evidence on the record. What reached the remote is the
  // Agent's own push and nothing deevy did, so there is nothing of deevy's to
  // check there.
  const links = (await human(origin, "links/list", { issue: issueKey }, ada)).links as Array<{
    kind: string;
    url: string;
    runId: string | null;
  }>;
  check(
    "one pull request, the Agent's, attributed to the attempt that produced it",
    links.length === 1 &&
      links[0]?.kind === "pull_request" &&
      links[0]?.url === pullRequest &&
      links[0]?.runId === runId,
    JSON.stringify(links),
  );

  const ruled = await until(
    deployment,
    "the ruling reaching the tracker",
    async () => (await said(origin, record)).find((one) => one.includes("Ship it")) ?? null,
  );
  check(
    "the ruling is said back in the tracker too, with the arithmetic",
    ruled.includes("1 of 1") || ruled.toLowerCase().includes("approved"),
    ruled,
  );
  // And nothing else: a Gate waiting is one comment, its Ruling another, and a
  // Ruling the tracker could not count is answered where it was made. A Run
  // starting, working or finishing says nothing on the record
  // (docs/plans/simplify.md, slice 4).
  const spoken = (await said(origin, record)).map((one) =>
    one.startsWith("**Waiting on a ruling")
      ? "gate"
      : one.startsWith("**Approved**") || one.startsWith("**Rejected**")
        ? "ruling"
        : one.includes("ruled nothing")
          ? "refused"
          : one.split("\n")[0],
  );
  check(
    "and deevy says nothing else there: two Gates, their two Rulings, two Rulings refused",
    JSON.stringify([...spoken].sort()) ===
      JSON.stringify(["gate", "gate", "refused", "refused", "ruling", "ruling"]),
    JSON.stringify(spoken),
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
    story ===
      "run.started run.activity gate.requested run.awaiting_input gate.ruling_refused " +
        "identity.linked gate.approved run.answered issue.link_added gate.requested " +
        "run.awaiting_input gate.ruling_refused gate.approved run.answered " +
        "run.completed",
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

  return story;
}

async function main(): Promise<void> {
  const given = process.argv.indexOf("--url");
  if (given !== -1) {
    // An instance somebody else started names its own containers, so the
    // repository the Agent pushes to is theirs to say.
    const repo = process.env.DEEVY_ACCEPTANCE_REPO ?? "";
    if (!repo) {
      throw new Error(
        "Set DEEVY_ACCEPTANCE_REPO to a bare repository the Agent may clone and push to",
      );
    }
    await walk(
      {
        name: "given",
        origin: process.argv[given + 1] ?? "",
        tick: () => Promise.resolve(),
        stop: () => undefined,
      },
      "an instance that is already running",
      repo,
    );
  } else {
    // Every deployment, from one codebase, and the Agent cannot tell them
    // apart: that is the claim ADR-0006 makes and this is what checks it. And
    // the image once more under a path, which is where a hosted Workspace
    // lives (docs/plans/hosted.md): nothing the walk does may notice. Then a
    // hosted Workspace itself, in its object behind the many-Workspaces
    // Worker, signed in through the relay (ADR-0028).
    const stories: Record<string, string> = {};
    const underAPath = (options: StartOptions) => startNode({ ...options, basePath: "/deevy" });
    for (const start of [startNode, startWorkers, underAPath, startHosted]) {
      let deployment: Deployment | null = null;
      // A repository each: the walk pushes the same branch on every one, and a
      // shared remote would make the second push a non-fast-forward.
      const repo = await remote();
      try {
        // The tracker holds the container and nothing about the code: deevy
        // never learns where the repository is.
        deployment = await start({ containers: CONTAINER });
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
    check(
      "and under a path",
      stories.node !== undefined && stories.node === stories["node under a path"],
      `node:    ${stories.node ?? "(none)"}\nunder a path: ${stories["node under a path"] ?? "(none)"}`,
    );
    check(
      "and in a hosted Workspace",
      stories.node !== undefined && stories.node === stories.hosted,
      `node:    ${stories.node ?? "(none)"}\nhosted:  ${stories.hosted ?? "(none)"}`,
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
