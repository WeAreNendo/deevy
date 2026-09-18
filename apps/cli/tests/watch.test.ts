import { describe, expect, it } from "vite-plus/test";
import { plain } from "../src/render.ts";
import { eventLine, watch } from "../src/watch.ts";
import type { DeevyClient } from "../src/client.ts";
import { gateUrl, openGate, type Reporter } from "../src/identity.ts";

/** Everything the CLI said, so a test reads what a person would see. */
function collect(): Reporter & { lines: { out: string[]; err: string[] } } {
  const lines = { out: [] as string[], err: [] as string[] };
  return {
    lines,
    out: (line: string) => lines.out.push(line),
    err: (line: string) => lines.err.push(line),
  };
}

type Message =
  | { type: "event"; event: { seq: number; kind: string; issueKey?: string } }
  | { type: "heartbeat"; cursor: number | null };

/**
 * An instance whose stream ends itself, which is what a Workers deployment
 * does: each poll is one D1 query against a per-invocation cap, so the stream
 * signs off with the cursor rather than staying open (ADR-0012).
 */
function endingStreams(rounds: Message[][]): {
  client: DeevyClient;
  asked: { after?: number }[];
} {
  const asked: { after?: number }[] = [];
  let round = 0;
  const client = {
    events: {
      subscribe: (input: { after?: number }) => {
        asked.push(input);
        const messages = rounds[round] ?? [];
        round += 1;
        async function* stream(): AsyncGenerator<Message, void, undefined> {
          for (const message of messages) yield message;
        }
        return Promise.resolve(stream());
      },
    },
  };
  return { client: client as unknown as DeevyClient, asked };
}

describe("following the Event log", () => {
  /**
   * The bug this whole module is shaped around. A `for await` that runs once
   * works against the Docker deployment, where the stream stays open, and
   * silently stops after one poll against a Workers one — which is found in
   * production rather than in a test unless a test says so.
   */
  it("picks the stream back up when it ends having said something", async () => {
    const { client, asked } = endingStreams([
      [{ type: "event", event: { seq: 1, kind: "issue.created" } }],
      [{ type: "event", event: { seq: 2, kind: "issue.moved" } }],
    ]);
    const said: string[] = [];
    const reached = await watch(client, { out: (line) => said.push(line), limit: 2, idleMs: 1 });

    expect(said).toHaveLength(2);
    expect(reached).toBe(2);
    // And it resumed from where it got to, rather than from the beginning.
    expect(asked[1]?.after).toBe(1);
  });

  it("resumes from a heartbeat, which is how a quiet stream still moves", async () => {
    const { client, asked } = endingStreams([
      [{ type: "heartbeat", cursor: 41 }],
      [{ type: "event", event: { seq: 42, kind: "run.finished" } }],
    ]);
    await watch(client, { out: () => {}, limit: 1, idleMs: 1 });
    expect(asked[1]?.after).toBe(41);
  });

  it("waits after a stream that said nothing, rather than spinning", async () => {
    const { client } = endingStreams([[], [{ type: "event", event: { seq: 1, kind: "x" } }]]);
    const started = Date.now();
    await watch(client, { out: () => {}, limit: 1, idleMs: 60 });
    // A stream that ends empty has nothing to resume from, so reconnecting at
    // once would be a hot loop against the instance.
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });

  it("stops when it is told to, without losing where it was", async () => {
    const { client } = endingStreams([[{ type: "event", event: { seq: 7, kind: "x" } }]]);
    const stopping = new AbortController();
    const said: string[] = [];
    const reached = watch(client, {
      out: (line) => {
        said.push(line);
        stopping.abort();
      },
      signal: stopping.signal,
      idleMs: 1,
    });
    expect(await reached).toBe(7);
  });

  it("says when it is reconnecting, so a quiet watch is not mistaken for a working one", async () => {
    const client = {
      events: {
        subscribe: () => Promise.reject(new Error("the instance went away")),
      },
    } as unknown as DeevyClient;
    const stopping = new AbortController();
    const said: string[] = [];
    setTimeout(() => {
      stopping.abort();
    }, 30);
    await watch(client, { out: (line) => said.push(line), signal: stopping.signal, idleMs: 5 });
    expect(said.join("\n")).toContain("the instance went away");
  });
});

describe("an Event as a line", () => {
  it("is what changed, what it was about, and when", () => {
    const said = eventLine(
      {
        seq: 42,
        kind: "issue.moved",
        issueKey: "DEV-7",
        createdAt: new Date("2026-09-18T10:11:12Z"),
      },
      plain,
    );
    expect(said).toContain("42");
    expect(said).toContain("issue.moved");
    expect(said).toContain("DEV-7");
    expect(said).toContain("2026-09-18 10:11:12");
  });

  it("does not invent an Issue for an Event that is not about one", () => {
    expect(eventLine({ seq: 1, kind: "member.joined" }, plain)).not.toContain("undefined");
  });
});

describe("a Gate", () => {
  it("is opened where it can be ruled, rather than refused where it cannot", async () => {
    const said = collect();
    const url = await openGate("https://deevy.example.com", "DEV-42", {
      openBrowser: false,
      report: said,
    });
    expect(url).toBe("https://deevy.example.com/issues/DEV-42");
    // The URL goes to stdout so it can be piped; the explanation does not.
    expect(said.lines.out).toEqual([url]);
    expect(said.lines.err.join(" ")).toContain("by a Human, in a browser");
  });

  it("builds the link deevy builds for itself", () => {
    // Same shape as packages/core/src/slack.ts, and a key is escaped.
    expect(gateUrl("https://deevy.example.com/", "DEV-1")).toBe(
      "https://deevy.example.com/issues/DEV-1",
    );
    expect(gateUrl("https://d.example.com", "A B")).toContain("A%20B");
  });
});
