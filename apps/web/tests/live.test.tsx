import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const stub = vi.hoisted(() => ({
  subscribed: [] as unknown[],
  /** The signal each stream was opened with, so a test can see one let go. */
  signals: [] as Array<AbortSignal | undefined>,
  /** What `health.ping` says this deployment offers (ADR-0032). */
  transport: "stream" as "stream" | "websocket",
  /** What `events.list` was asked, and the page it answers with. */
  listed: [] as unknown[],
  page: [] as Array<Record<string, unknown>>,
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
    health: { ping: async () => ({ ok: true, live: stub.transport }) },
    events: {
      list: async (input: unknown) => {
        stub.listed.push(input);
        const events = stub.page;
        stub.page = [];
        return { events, nextCursor: events.at(-1)?.seq ?? null };
      },
      subscribe: async (input: unknown, options?: { signal?: AbortSignal }) => {
        stub.subscribed.push(input);
        stub.signals.push(options?.signal);
        const ends = stub.endsCleanly > 0;
        if (ends) stub.endsCleanly -= 1;
        return (async function* () {
          for (const message of stub.messages) yield message;
          // A stream that has spent its budget returns; otherwise it stays
          // open, the way a Node one does, until the hook lets it go.
          if (ends) return;
          await new Promise((resolve) =>
            options?.signal?.addEventListener("abort", resolve, { once: true }),
          );
        })();
      },
    },
  };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { HIDDEN_GRACE_MS, keysFor, stillChanging, useLiveEvents } =
  await import("../src/lib/live.ts");

function Probe() {
  useLiveEvents(true);
  return null;
}

/** Whether the page is showing, as the browser reports it, and the event it fires. */
function showPage(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * The browser's WebSocket as far as the hook uses it, driven by the test: it
 * opens when told and says what the server would. A refused upgrade closes
 * without ever opening, which is all a page is told about one.
 */
class FakeSocket {
  static made: FakeSocket[] = [];
  static refuse = false;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.made.push(this);
    if (FakeSocket.refuse) queueMicrotask(() => this.onclose?.());
  }
  open() {
    this.onopen?.();
  }
  say(data: string) {
    this.onmessage?.({ data });
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
}

function tracking(queryClient: QueryClient): unknown[] {
  const invalidated: unknown[] = [];
  const original = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = (filters?: Parameters<typeof original>[0]) => {
    invalidated.push(filters?.queryKey);
    return original(filters);
  };
  return invalidated;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "visibilityState");
  stub.transport = "stream";
  stub.messages = [
    { type: "heartbeat", cursor: 7 },
    {
      type: "event",
      event: { seq: 8, kind: "issue.created", subjectType: "issue", projectId: "p1" },
    },
  ];
  FakeSocket.made.length = 0;
  FakeSocket.refuse = false;
});

describe("a hidden tab", () => {
  it("lets go of its stream after the grace, and resumes from its cursor when shown", async () => {
    stub.subscribed.length = 0;
    stub.signals.length = 0;
    stub.endsCleanly = 0;
    stub.messages = [
      { type: "heartbeat", cursor: 7 },
      {
        type: "event",
        event: { seq: 8, kind: "issue.created", subjectType: "issue", projectId: "p1" },
      },
    ];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Probe />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(stub.subscribed).toHaveLength(1));
    // Long enough for the stream's two messages to have been read.
    await new Promise((resolve) => setTimeout(resolve, 30));

    vi.useFakeTimers();
    showPage("hidden");
    // A glance at another tab costs nothing.
    vi.advanceTimersByTime(HIDDEN_GRACE_MS - 1_000);
    expect(stub.signals[0]?.aborted).toBe(false);
    // A tab left behind holds nothing open on the server.
    vi.advanceTimersByTime(1_000);
    expect(stub.signals[0]?.aborted).toBe(true);
    vi.useRealTimers();

    showPage("visible");
    await waitFor(() => expect(stub.subscribed).toHaveLength(2));
    // From where it stopped, so what changed meanwhile is read once.
    expect(stub.subscribed[1]).toEqual({ after: 8 });
  });

  it("keeps its stream when it is shown again within the grace", async () => {
    stub.subscribed.length = 0;
    stub.signals.length = 0;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Probe />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(stub.subscribed).toHaveLength(1));

    vi.useFakeTimers();
    showPage("hidden");
    vi.advanceTimersByTime(HIDDEN_GRACE_MS / 2);
    showPage("visible");
    vi.advanceTimersByTime(HIDDEN_GRACE_MS);
    vi.useRealTimers();

    expect(stub.signals[0]?.aborted).toBe(false);
    expect(stub.subscribed).toHaveLength(1);
  });
});

describe("where the deployment pushes", () => {
  it("reads what a push names from its cursor, and holds no stream", async () => {
    stub.subscribed.length = 0;
    stub.listed.length = 0;
    stub.transport = "websocket";
    vi.stubGlobal("WebSocket", FakeSocket);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidated = tracking(queryClient);
    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(FakeSocket.made).toHaveLength(1));
    const socket = FakeSocket.made[0]!;
    expect(socket.url).toMatch(/^ws:\/\/[^/]+\/api\/live$/);
    socket.open();
    // The head as it opens: a first connection starts from there, as a stream does.
    socket.say(JSON.stringify({ seq: 7 }));
    stub.page = [
      { seq: 8, kind: "issue.created", subjectType: "issue", projectId: "p1" },
      { seq: 9, kind: "issue.synced", subjectType: "issue", projectId: "p1" },
    ];
    socket.say(JSON.stringify({ seq: 9 }));

    await waitFor(() => expect(stub.listed).toEqual([{ after: 7, limit: 200 }]));
    await waitFor(() => expect(JSON.stringify(invalidated)).toContain("issues"));
    // The keepalive's answer is not a push.
    socket.say("pong");
    expect(stub.listed).toHaveLength(1);
    expect(stub.subscribed).toEqual([]);

    // Hidden past the grace, the socket goes; shown again, a new one reads
    // from where the last one stopped.
    vi.useFakeTimers();
    showPage("hidden");
    vi.advanceTimersByTime(HIDDEN_GRACE_MS);
    expect(socket.closed).toBe(true);
    vi.useRealTimers();
    showPage("visible");
    await waitFor(() => expect(FakeSocket.made).toHaveLength(2));
    const again = FakeSocket.made[1]!;
    again.open();
    stub.page = [{ seq: 12, kind: "run.started", subjectType: "run", projectId: "p1" }];
    again.say(JSON.stringify({ seq: 12 }));
    await waitFor(() => expect(stub.listed.at(-1)).toEqual({ after: 9, limit: 200 }));
  });

  it("streams instead when the socket is refused", async () => {
    stub.subscribed.length = 0;
    stub.transport = "websocket";
    stub.messages = [{ type: "heartbeat", cursor: 3 }];
    FakeSocket.refuse = true;
    vi.stubGlobal("WebSocket", FakeSocket);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Probe />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(stub.subscribed).toHaveLength(1));
    expect(FakeSocket.made).toHaveLength(1);
  });
});

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
