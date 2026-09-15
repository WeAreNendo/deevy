import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { createAuth } from "../src/auth.ts";
import { router } from "../src/operations/index.ts";
import { agentContext, memberContext, testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const modern = "2026-07-28";
const envelope = {
  "io.modelcontextprotocol/protocolVersion": modern,
  // URL elicitation is negotiated per request: a client that does not declare
  // it is refused rather than handed a link it cannot open.
  "io.modelcontextprotocol/clientCapabilities": { elicitation: { url: {} } },
  "io.modelcontextprotocol/clientInfo": { name: "claude-code", version: "0" },
};

interface Answer {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/** One tool call, exactly as an agent loop outside deevy would make it. */
async function tool(
  app: ReturnType<typeof createApp>,
  key: string,
  name: string,
  args: Record<string, unknown>,
  requestState?: string,
): Promise<Answer> {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": modern,
      "mcp-method": "tools/call",
      "mcp-name": name,
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        ...(requestState
          ? { requestState, inputResponses: { approval: { action: "accept" } } }
          : {}),
        _meta: envelope,
      },
    }),
  });
  if (res.status !== 200) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as Answer;
}

function structured(answer: Answer): Record<string, unknown> {
  expect(answer.error).toBeUndefined();
  if (answer.result?.isError) throw new Error(JSON.stringify(answer.result.content));
  return answer.result?.structuredContent as Record<string, unknown>;
}

/**
 * M2's definition of done, from docs/PLAN.md: "a Claude Code loop outside deevy
 * picks up an assigned Issue, writes a plan Document, hits the Plan Gate, and
 * resumes after a Human approves in deevy."
 *
 * Everything the loop does goes over /mcp with an Agent's API key, and
 * everything the Human does goes through the operations the SPA calls, so the
 * two halves meet only where they would in production.
 */
describe("the milestone", () => {
  it("is a loop outside deevy working an Issue and a Human deciding its Gate", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const auth = createAuth({
      db,
      env: {
        baseURL: "http://localhost:3000",
        secret: "test-secret-that-is-at-least-32-characters",
        providers: { github: { clientId: "id", clientSecret: "secret" } },
      },
    });
    const app = createApp({ db, auth, baseURL: "http://localhost:3000" });

    // A Human sets the work up, the way an admin does on a fresh instance.
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const asAda = createRouterClient(router, { context: ada });
    const project = await asAda.projects.create({ name: "deevy", key: "DEV" });
    const planner = await agentContext(db, {
      sponsor: ada.member,
      name: "Planner",
      grants: [project.id],
    });
    const issued = await auth.api.createApiKey({
      body: { userId: planner.member.userId, name: "ci" },
    });
    const key = issued.key;

    // Assigning to the Agent is the trigger: a Run exists before the loop wakes.
    const issue = await asAda.issues.create({ projectKey: "DEV", title: "Ship M2" });
    await asAda.issues.update({ key: "DEV-1", assigneeMemberId: planner.member.id });
    await asAda.gates.approve({ key: "DEV-1" });
    await asAda.gates.approve({ key: "DEV-1" });
    expect(issue.key).toBe("DEV-1");

    const triggered = await asAda.runs.list({ issueKey: "DEV-1" });
    expect(triggered.runs[0]).toMatchObject({ trigger: "assignment", status: "pending" });

    // From here everything is the loop, over MCP, with nothing but its key.
    const read = structured(await tool(app, key, "issues_get", { key: "DEV-1" }));
    expect(read).toMatchObject({ key: "DEV-1", state: { name: "Plan" } });

    // The loop finds the Run the trigger already opened rather than starting a
    // second one. Without runs_list as a tool an Agent with no webhook URL has
    // no way to discover its own work, which is the polling fallback ADR-0003
    // requires.
    const mine = structured(await tool(app, key, "runs_list", { status: "pending" }));
    const pending = (mine.runs as Array<{ id: string; issueKey: string }>)[0];
    expect(pending).toMatchObject({ issueKey: "DEV-1" });
    const runId = pending.id;
    await tool(app, key, "runs_post_activity", {
      runId,
      kind: "thought",
      body: "Reading the intent",
    });
    const intent = structured(
      await tool(app, key, "documents_get", { issueKey: "DEV-1", name: "intent" }),
    );
    expect(intent.body as string).toContain("## Problem");

    await tool(app, key, "documents_write", {
      issueKey: "DEV-1",
      name: "plan",
      body: "## Files that change\n- packages/core\n",
    });

    // It reaches the Plan Gate and asks. The Run stops; the URL is for a Human.
    const asked = (await tool(app, key, "runs_request_approval", { runId })).result as {
      resultType: string;
      requestState: string;
      inputRequests: { approval: { params: { url: string; mode: string } } };
    };
    expect(asked.resultType).toBe("input_required");
    expect(asked.inputRequests.approval.params.mode).toBe("url");
    expect(asked.inputRequests.approval.params.url).toContain("/issues/DEV-1?gate=");
    const requestState = asked.requestState;

    const waiting = await asAda.runs.get({ runId });
    expect(waiting.status).toBe("awaiting_input");

    // The Agent may not decide it, however it asks.
    const refused = await tool(app, key, "gates_approve", { key: "DEV-1" });
    expect(refused.result?.isError ?? refused.error).toBeTruthy();

    // A Human approves in deevy, in a browser.
    await asAda.gates.approve({ key: "DEV-1", note: "Looks right" });

    // The loop retries the same call, carrying back the state it was given, and
    // is told the ruling so it can carry on.
    const retried = await tool(app, key, "runs_request_approval", { runId }, requestState);
    const answered = structured(retried);
    expect(answered).toMatchObject({ status: "approved", note: "Looks right" });
    expect(await asAda.runs.get({ runId })).toMatchObject({ status: "active" });

    await tool(app, key, "links_add", {
      issueKey: "DEV-1",
      url: "https://github.com/WeAreNendo/deevy/pull/12",
      runId,
    });
    const finished = structured(
      await tool(app, key, "runs_finish", { runId, status: "completed", summary: "Planned it" }),
    );
    expect(finished).toMatchObject({ status: "completed", summary: "Planned it" });

    // The Issue moved, the evidence is attached, and the Human was told.
    expect(await asAda.issues.get({ key: "DEV-1" })).toMatchObject({ state: { name: "Build" } });
    expect((await asAda.links.list({ issueKey: "DEV-1" })).links[0]).toMatchObject({
      kind: "pull_request",
      ref: "12",
    });
    const inbox = await asAda.inbox.list({});
    expect(inbox.notifications.some((row) => row.kind === "run_finished")).toBe(true);

    // And the Event log tells the whole story, with the Agent as the actor.
    const events = await asAda.events.list({ subjectType: "run" });
    expect(events.events.map((row) => row.kind)).toEqual([
      "run.started",
      "run.activity",
      "run.activity",
      "run.awaiting_input",
      "run.answered",
      "run.activity",
      "run.completed",
    ]);
    // Accountability reads straight off the log: the Agent did the work, and
    // the one Event it could not cause itself carries the Human who did.
    // Accountability reads straight off the log. The Agent narrated its own
    // work; the two Events it could not cause itself carry the Human who did,
    // so the Human answerable for any of this is one hop away (docs/PLAN.md):
    // Ada assigned the Issue, which started the Run, and Ada decided the Gate.
    const humansTurn = ["run.started", "run.answered"];
    for (const row of events.events) {
      expect([row.kind, row.actorMemberId]).toEqual([
        row.kind,
        humansTurn.includes(row.kind) ? ada.member.id : planner.member.id,
      ]);
    }
  });
});
