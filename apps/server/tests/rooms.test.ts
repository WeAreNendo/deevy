import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import * as Y from "yjs";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { buildServer } from "../src/server.ts";
import { serveRooms } from "../src/rooms.ts";
import type { ServerEnv } from "../src/env.ts";

const closers: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

const env: ServerEnv = {
  port: 0,
  databasePath: ":memory:",
  migrationsFolder: new URL("../../../packages/db/drizzle", import.meta.url).pathname,
  providers: {},
  runStaleMinutes: 30,
  sweepIntervalSeconds: 60,
  gateReminderHours: 4,
  devStubOAuth: false,
};

/** The whole Node deployment, listening on a port nobody chose, with its rooms mounted. */
async function listening() {
  const built = buildServer(env);
  const server = serve({ fetch: built.app.fetch, port: 0 });
  await new Promise((ready) => server.once("listening", ready));
  const rooms = serveRooms({ server, room: built.rooms });
  const { port } = server.address() as AddressInfo;
  closers.push(
    () =>
      new Promise<void>((done) => {
        // A listener with a websocket on it never finishes closing, and the
        // whole point of this test is that there is one.
        rooms.close();
        server.close(() => {
          built.close();
          done();
        });
      }),
  );
  return `ws://127.0.0.1:${String(port)}/collab`;
}

describe("the room on the Node deployment", () => {
  it("upgrades /collab and refuses a socket that carries no session", async () => {
    const url = await listening();
    let opened = false;
    let refusedBecause = "";
    const socket = new HocuspocusProviderWebsocket({
      url,
      // Whether the upgrade happened at all: without this, a server with no
      // such route and a server that refused the room look identical from here.
      onOpen: () => {
        opened = true;
      },
      maxAttempts: 1,
    });
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: "document:DEV-1:intent",
      document: new Y.Doc(),
      token: "cookie",
      // A refused Document does not close the socket in Hocuspocus 4 — several
      // Documents share one — so the refusal arrives here instead.
      onAuthenticationFailed: ({ reason }) => {
        refusedBecause = reason;
      },
    });
    provider.attach();
    closers.push(() => {
      provider.destroy();
      socket.destroy();
    });

    await new Promise((settled) => setTimeout(settled, 500));

    // The upgrade happened: `/collab` is a websocket route on the same origin
    // and the same port as the API, which is what lets a browser bring its
    // session cookie along.
    expect(opened).toBe(true);
    // And the room refused it. The wire says only "permission-denied" — the
    // reason deevy gave stays on the server, which is the right way round —
    // but reaching this at all is the whole path: upgrade, context built from
    // the request's own headers, no Member, refusal.
    expect(refusedBecause).toBe("permission-denied");
    expect(provider.isAuthenticated).toBe(false);
  });
});
