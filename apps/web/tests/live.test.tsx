import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

const stub = vi.hoisted(() => ({
  subscribed: [] as unknown[],
  messages: [
    { type: "heartbeat", cursor: 7 },
    {
      type: "event",
      event: { seq: 8, kind: "issue.created", subjectType: "issue", projectId: "p1" },
    },
  ],
  /**
   * How many streams end of their own accord before the rest stay open. A
   * Worker's stream ends when its budget is spent, and what the hook does next
   * is the difference between a board that is a poll behind and one that is two
   * seconds behind (docs/plans/m3.md slice 7).
   */
  endsCleanly: 0,
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = {
    issues: { list: async () => ({ issues: [], nextCursor: null }) },
    projects: { list: async () => ({ projects: [] }) },
    members: { list: async () => ({ members: [] }) },
    allowlist: { list: async () => ({ rules: [] }) },
    invitations: { list: async () => ({ invitations: [] }) },
    sockets: { list: async () => ({ sockets: [] }) },
    // Namespaces the hook only ever names a key of; nothing here is called.
    comments: {},
    links: {},
    inbox: {},
    // stillChanging tells a Run's detail from its list by key, so both need a shape.
    runs: { get: async () => ({}), list: async () => ({ runs: [] }) },
    agents: {},
    channels: {},
    routing: {},
    webhooks: {},
    workspace: {},
    me: {},
    events: {
      list: async () => ({ events: [], nextCursor: null }),
      subscribe: async (input: unknown) => {
        stub.subscribed.push(input);
        const ends = stub.endsCleanly > 0;
        if (ends) stub.endsCleanly -= 1;
        return (async function* () {
          for (const message of stub.messages) yield message;
          // A stream that has spent its budget returns; otherwise it stays
          // open, the way a Node one does.
          if (ends) return;
          await new Promise(() => {});
        })();
      },
    },
  };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { keysFor, stillChanging, useLiveEvents } = await import("../src/lib/live.ts");

function Probe() {
  useLiveEvents(true);
  return null;
}

describe("useLiveEvents", () => {
  it("subscribes and re-reads the queries an Event could have changed", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidated: unknown[] = [];
    const original = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = (filters?: Parameters<typeof original>[0]) => {
      invalidated.push(filters?.queryKey);
      return original(filters);
    };

    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(stub.subscribed.length).toBeGreaterThan(0));
    await waitFor(() => expect(invalidated.length).toBeGreaterThan(1));
    // An Event about an Issue re-reads the Issue queries, not the Member ones.
    const keys = JSON.stringify(invalidated);
    expect(keys).toContain("issues");
    expect(keys).not.toContain("members");
  });

  it("resubscribes from the cursor at once when the stream ends on purpose", async () => {
    stub.subscribed.length = 0;
    stub.endsCleanly = 1;
    stub.messages = [
      { type: "heartbeat", cursor: 7 },
      {
        type: "event",
        event: { seq: 8, kind: "issue.created", subjectType: "issue", projectId: "p1" },
      },
      // The sign-off a Worker's stream ends with: where it got to.
      { type: "heartbeat", cursor: 8 },
    ];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );

    // Well inside the two seconds a failed stream costs: an end on purpose is
    // not a failure and must not be paid for like one.
    await waitFor(() => expect(stub.subscribed.length).toBe(2), { timeout: 500 });
    expect(stub.subscribed[1]).toEqual({ after: 8 });
  });

  it("resumes from the last seq it saw after the stream drops", async () => {
    stub.subscribed.length = 0;
    stub.endsCleanly = 0;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(stub.subscribed.length).toBeGreaterThan(0));
    // The first subscription starts with no cursor; the hook adopts the seq it
    // is told and would reconnect from there.
    expect(stub.subscribed[0]).toEqual({ after: undefined });
  });

  it("re-reads each key once for a burst of Events", async () => {
    stub.subscribed.length = 0;
    stub.endsCleanly = 0;
    // Two Events about Issues in one tick: one refetch of the Issue queries,
    // not two, however many screens hold one (docs/plans/ui-redesign.md).
    stub.messages = [
      {
        type: "event",
        event: { seq: 9, kind: "issue.created", subjectType: "issue", projectId: "p1" },
      },
      {
        type: "event",
        event: { seq: 10, kind: "issue.synced", subjectType: "issue", projectId: "p1" },
      },
    ];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidated: unknown[] = [];
    const original = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = (filters?: Parameters<typeof original>[0]) => {
      invalidated.push(filters?.queryKey);
      return original(filters);
    };

    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(invalidated.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const issueKeys = invalidated.filter((key) => JSON.stringify(key).includes('"issues"'));
    expect(issueKeys).toHaveLength(1);
    // And what an Issue Event touches beside the Issue: what is shown with it.
    const all = JSON.stringify(invalidated);
    expect(all).toContain("comments");
    expect(all).toContain("inbox");
    expect(all).not.toContain("members");
  });
});

describe("keysFor", () => {
  it("re-reads what a Workspace Event and a Member Event show besides themselves", () => {
    // routing.updated is a Workspace Event, and me.get carries the Workspace's name.
    const workspace = JSON.stringify(keysFor({ subjectType: "workspace", projectId: null }));
    expect(workspace).toContain('"workspace"');
    expect(workspace).toContain('"routing"');
    expect(workspace).toContain('"me"');
    // A role change or a suspension reaches the caller through me.get.
    const member = JSON.stringify(keysFor({ subjectType: "member", projectId: null }));
    expect(member).toContain('"members"');
    expect(member).toContain('"me"');
    // And an Issue Event still leaves the caller alone.
    expect(JSON.stringify(keysFor({ subjectType: "issue", projectId: "p1" }))).not.toContain(
      '"me"',
    );
  });
});

describe("stillChanging", () => {
  it("leaves a finished Run's detail alone and re-reads everything else", async () => {
    const { orpc } = await import("../src/lib/orpc.ts");
    const queryClient = new QueryClient();
    const finished = orpc.runs.get.queryKey({ input: { runId: "run-done" } });
    const working = orpc.runs.get.queryKey({ input: { runId: "run-busy" } });
    // The predicate reads one field, so a partial Run is all the cache needs.
    const seed = (key: unknown, data: unknown) =>
      queryClient.setQueryData(key as never, data as never);
    seed(finished, { id: "run-done", finishedAt: new Date(), activities: [] });
    seed(working, { id: "run-busy", finishedAt: null, activities: [] });
    seed(orpc.runs.list.queryKey({ input: { issue: "acme/deevy#1" } }), { runs: [] });

    const cache = queryClient.getQueryCache();
    const verdict = (key: unknown) => stillChanging(cache.find({ queryKey: key as never })!);
    expect(verdict(finished)).toBe(false);
    expect(verdict(working)).toBe(true);
    expect(verdict(orpc.runs.list.queryKey({ input: { issue: "acme/deevy#1" } }))).toBe(true);
  });
});
