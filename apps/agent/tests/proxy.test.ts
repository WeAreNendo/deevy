import { networkInterfaces } from "node:os";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  mcpEnvelope,
  mcpProtocolVersion,
  messagesIn,
  openProxy,
  type Proxy,
} from "../src/proxy.ts";
import { deevyToolNames } from "../src/tools.ts";
import { runOnce } from "../src/work.ts";
import { finished, instance, scripted } from "./helpers.ts";

const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

const envelope = {
  ...mcpEnvelope,
  "io.modelcontextprotocol/clientInfo": { name: "proxy-test", version: "0" },
};

/** A JSON-RPC request the way a harness sends one: no credential. */
async function rpc(
  url: string,
  method: string,
  params: Record<string, unknown> = {},
  id: number = 1,
): Promise<{ status: number; message: ReturnType<typeof messagesIn>[number] | undefined }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": mcpProtocolVersion,
      "mcp-method": method,
      ...(typeof params.name === "string" ? { "mcp-name": params.name } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, _meta: envelope } }),
  });
  const text = await response.text();
  const messages = messagesIn(text, response.headers.get("content-type") ?? "");
  return { status: response.status, message: messages.find((m) => m.id === id) ?? messages[0] };
}

async function proxied(it: Awaited<ReturnType<typeof instance>>, denied: string[] = []) {
  const proxy = await it.proxy({
    onDenied: (name) => {
      denied.push(name);
    },
  });
  closers.push(() => proxy.close());
  return proxy;
}

describe("the key stays with the supervisor", () => {
  it("answers on loopback with no credential, and deevy sees the Agent", async () => {
    const it = await instance();
    closers.push(it.close);
    const proxy = await proxied(it);

    expect(proxy.url).toBe(`http://127.0.0.1:${proxy.port}/mcp`);
    const { status, message } = await rpc(proxy.url, "tools/call", {
      name: "runs_list",
      arguments: {},
    });

    expect(status).toBe(200);
    expect(message?.result).toMatchObject({ structuredContent: { runs: [] } });
  });

  it("lists exactly the tools the runtime grants, and nothing deevy would add", async () => {
    const it = await instance();
    closers.push(it.close);
    const proxy = await proxied(it);

    const { message } = await rpc(proxy.url, "tools/list");
    const names = (message?.result?.tools ?? []).map((tool) => tool.name).sort();

    // The runtime's list is an allowlist, not a demand: it is intersected with
    // what deevy offers, so this is the whole job an Agent has here — read the
    // work, narrate it, ask at a Checkpoint, split it, open the pull request,
    // finish (src/tools.ts).
    expect(names).toEqual([
      "comments_create",
      "gates_get",
      "gates_request",
      "inbox_list",
      "issues_create",
      "issues_get",
      "links_add",
      "pulls_open",
      "runs_finish",
      "runs_get",
      "runs_list",
      "runs_post_activity",
      "runs_start",
    ]);
    expect(names.every((name) => deevyToolNames.includes(name))).toBe(true);
    // deevy offers this Agent more besides, since `me_get`, `issues_list` and
    // the rest are an Agent's to call; the runtime grants none of them.
    expect(names).not.toContain("issues_list");
  });

  it("refuses a tool it does not list before deevy hears of it, and says so", async () => {
    const it = await instance();
    closers.push(it.close);
    const denied: string[] = [];
    const proxy = await proxied(it, denied);
    const before = it.refused.length;

    // A tool deevy really does offer this Agent, and the runtime does not grant.
    const { status, message } = await rpc(proxy.url, "tools/call", {
      name: "issues_list",
      arguments: {},
    });

    expect(status).toBe(200);
    expect(message?.error).toMatchObject({ code: -32602 });
    expect(JSON.stringify(message?.error)).toContain("issues_list");
    expect(denied).toEqual(["issues_list"]);
    // Nothing reached deevy: a refusal that lands in deevy's log on nothing
    // going wrong is the wrong blast radius for a routine one.
    expect(it.refused.length).toBe(before);
  });

  it("answers the same as the key would for what it does grant", async () => {
    const it = await instance();
    closers.push(it.close);
    const proxy = await proxied(it);
    // Routed to nobody, so the Run this opens through the key is the first one.
    const issue = await it.asAda.issues.create({
      projectSlug: it.project.slug,
      title: "Through the proxy",
    });

    const { message } = await rpc(proxy.url, "tools/call", {
      name: "issues_get",
      arguments: { issue: issue.externalKey },
    });
    const direct = (await it.asAgent(`/issues/${encodeURIComponent(issue.externalKey)}/runs`)) as {
      issueKey: string;
    };

    expect(message?.result).toMatchObject({
      structuredContent: { externalKey: "acme/deevy#1", title: "Through the proxy" },
    });
    expect(direct.issueKey).toBe("acme/deevy#1");
  });

  it("takes no batch, since a batch could hide a refused call beside an allowed one", async () => {
    const it = await instance();
    closers.push(it.close);
    const proxy = await proxied(it);

    const response = await fetch(proxy.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "runs_list" } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "gates_approve" } },
      ]),
    });

    expect(response.status).toBe(400);
  });

  it("is loopback by address, so nothing off this host can reach it", async () => {
    const it = await instance();
    closers.push(it.close);
    const proxy = await proxied(it);

    const external = Object.values(networkInterfaces())
      .flat()
      .find((address) => address && !address.internal && address.family === "IPv4");
    if (!external) return;

    await expect(
      fetch(`http://${external.address}:${proxy.port}/mcp`, { method: "POST", body: "{}" }),
    ).rejects.toThrow();
  });
});

describe("the probe", () => {
  it("says deevy answers this key", async () => {
    const it = await instance();
    closers.push(it.close);
    const proxy = await proxied(it);

    expect(await proxy.probe()).toBeNull();
  });

  it("says why when it does not, in words for the Run's feed", async () => {
    const it = await instance();
    closers.push(it.close);
    const proxy: Proxy = await openProxy({
      url: it.config.url,
      key: "not-a-key",
      tools: deevyToolNames,
      fetch: it.inProcess,
    });
    closers.push(() => proxy.close());

    expect(await proxy.probe()).toMatch(/deevy answered 401/);
  });

  it("fails the Run before a session starts when deevy cannot be reached", async () => {
    const it = await instance();
    closers.push(it.close);
    await it.assign("Unreachable");
    let started = false;
    const session = scripted([
      () => {
        started = true;
        return Promise.resolve();
      },
      finished,
    ]);

    const pass = await runOnce({
      deevy: it.deevy,
      session,
      runTimeoutMs: 5_000,
      proxy: () =>
        openProxy({
          url: "http://127.0.0.1:9",
          key: it.config.key,
          tools: deevyToolNames,
          fetch: () => Promise.reject(new Error("connect ECONNREFUSED")),
        }),
    });

    expect(started).toBe(false);
    expect(pass.worked[0]).toMatchObject({ status: "failed" });
    expect(pass.worked[0].failedBy).toContain("ECONNREFUSED");
  });
});

describe("a refusal in the Run's feed", () => {
  it("is written as an error Activity, from the proxy as from the harness", async () => {
    const it = await instance();
    closers.push(it.close);
    await it.assign("Reaching");

    const session = scripted([
      async (input) => {
        await rpc(input.mcpUrl, "tools/call", { name: "gates_approve", arguments: {} });
      },
      async () => {
        // The refusal's Activity already moved the Run to `active`.
        const [run] = await it.deevy.runs("active");
        await it.deevy.postActivity(run.id, "thought", "Carrying on");
      },
      finished,
    ]);

    const pass = await runOnce({ deevy: it.deevy, proxy: it.proxy, session, runTimeoutMs: 5_000 });
    const feed = await it.asAda.runs.get({ runId: pass.worked[0].runId });

    expect(feed.activities.map((activity) => [activity.kind, activity.body])).toEqual([
      ["error", "Refused gates_approve: not in this runtime's tool list"],
      ["thought", "Carrying on"],
      ["error", "The session ended without finishing this Run"],
    ]);
  });
});

describe("reading what deevy answers", () => {
  it("takes one JSON document or an event stream, whichever the server chose", () => {
    const json = '{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}';
    const sse = [
      "event: message",
      'data: {"jsonrpc":"2.0","method":"notifications/progress"}',
      "",
      'data: {"jsonrpc":"2.0","id":1,',
      'data: "result":{"tools":[]}}',
      "",
      "",
    ].join("\n");

    expect(messagesIn(json, "application/json")).toEqual([
      { jsonrpc: "2.0", id: 1, result: { tools: [] } },
    ]);
    expect(messagesIn(sse, "text/event-stream")).toEqual([
      { jsonrpc: "2.0", method: "notifications/progress" },
      { jsonrpc: "2.0", id: 1, result: { tools: [] } },
    ]);
  });
});
