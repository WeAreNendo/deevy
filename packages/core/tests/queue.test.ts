import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Job, JobQueue } from "../src/jobs.ts";
import { router } from "../src/operations/index.ts";
import { deliverDueWebhooks } from "../src/work.ts";
import { fakeSockets, memberContext, seedProject, testDb } from "./helpers.ts";

/**
 * The queue as the core sees it: a hint about when to look at a row that is
 * already durable (jobs.ts, docs/plans/m3.md slice 9). Nothing here knows what
 * a Cloudflare Queue is; what it knows is that a deployment which has one
 * hears about a delivery the moment it is owed, and that a deployment which
 * does not loses nothing.
 */

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const secret = "whsec_deevy_test_secret";

/** A queue that remembers what it was handed, and a failing one for the tail to survive. */
function recordingQueue(): JobQueue & { jobs: Job[] } {
  const jobs: Job[] = [];
  return {
    jobs,
    enqueue: async (job) => {
      jobs.push(job);
    },
  };
}

/**
 * An admin, a Project, and a URL subscribed to `issue.created` alone, so one
 * Issue owes exactly one delivery and the counting below means something.
 */
async function workspace(jobs: JobQueue) {
  const { db, close } = testDb();
  closers.push(close);
  const alice = await memberContext(db, { role: "admin", name: "Alice" });
  const { sockets } = fakeSockets();
  const asAlice = createRouterClient(router, { context: { ...alice, jobs, sockets } });
  const seeded = await seedProject(db, alice.workspace.id);
  const subscription = await asAlice.webhooks.create({
    url: "https://runtime.example/deevy",
    secret,
    kinds: ["issue.created"],
  });
  return { db, alice, asAlice, subscription, project: seeded.project };
}

describe("deriving a delivery with a queue behind it", () => {
  it("enqueues exactly one job, carrying the row's id and no payload", async () => {
    const queue = recordingQueue();
    const { asAlice, subscription, project } = await workspace(queue);
    // The subscription's own `webhook.subscribed` Event is not one it asked
    // for, so nothing has been owed yet.
    expect(queue.jobs).toEqual([]);

    await asAlice.issues.create({ projectSlug: project.slug, title: "Ship the thing" });

    const { deliveries } = await asAlice.webhooks.deliveries({
      subscriptionId: subscription.id,
    });
    expect(deliveries).toHaveLength(1);
    expect(queue.jobs).toEqual([{ kind: "webhook.delivery", id: deliveries[0]?.id }]);
  });
});

describe("deriving a delivery with a queue that is down", () => {
  it("still answers the request, and the sweep still delivers the row", async () => {
    const refusing: JobQueue = {
      enqueue: () => Promise.reject(new Error("the queue is unreachable")),
    };
    const { db, alice, asAlice, subscription, project } = await workspace(refusing);

    const issue = await asAlice.issues.create({
      projectSlug: project.slug,
      title: "Ship the thing",
    });
    expect(issue.externalKey).toBe("acme/deevy#new-1");

    const { deliveries } = await asAlice.webhooks.deliveries({
      subscriptionId: subscription.id,
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.deliveredAt).toBeNull();

    const posted: string[] = [];
    const sent = await deliverDueWebhooks({
      db,
      workspaceId: alice.workspace.id,
      fetch: async (url: string) => {
        posted.push(url);
        return new Response("", { status: 200 });
      },
    });

    expect(sent).toMatchObject({ scanned: 1, delivered: 1, failed: 0, gaveUp: 0 });
    expect(posted).toEqual(["https://runtime.example/deevy"]);
  });
});
