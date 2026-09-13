import { createDb } from "@deevy/adapters/workers";
import { loadMarkdown, markdownOf } from "@deevy/editor";
import {
  buildContext,
  createAuth,
  createRoomServer,
  roomSocket,
  serveRoomSocket,
} from "@deevy/core";
import type { LiveRooms, RuntimeSocket } from "@deevy/core";
import type { Hocuspocus } from "@hocuspocus/server";
import type { DurableObjectBinding, WorkerBindings } from "./env.ts";
import { readWorkerEnv, workerAuthEnv } from "./env.ts";

/**
 * One Durable Object per room, which is what makes a Durable Object the right
 * shape for this: a room is a single live text several Members are typing in,
 * and a single object is where that text can exist once. The Worker routes
 * `/collab` to the object named after the room, and everything after that is
 * the same `createRoomServer` the Node deployment runs
 * (docs/plans/collaborative-documents.md, ADR-0021).
 */
export class DocumentRoom {
  #room: Hocuspocus | null = null;
  readonly #bindings: WorkerBindings;

  // Cloudflare constructs one of these per object, with its state and the same
  // bindings the Worker itself was given. The state is the object's own
  // storage, which this slice does not use yet: the text is still in memory
  // until the slice that persists it.
  constructor(_state: DurableObjectState, bindings: WorkerBindings) {
    this.#bindings = bindings;
  }

  /** Built once per object, not once per connection: the room outlives a socket. */
  #server(): Hocuspocus {
    if (this.#room) return this.#room;
    const env = readWorkerEnv(this.#bindings);
    const db = createDb(this.#bindings.DB);
    const auth = createAuth({ db, env: workerAuthEnv(env) });
    this.#room = createRoomServer({
      db,
      // The session on the upgrade request, then the Member, then the same
      // authorization the Document's own operations apply.
      contextFrom: (request) => buildContext(db, auth, request.headers, env.baseURL),
    });
    return this.#room;
  }

  async fetch(request: Request): Promise<Response> {
    /*
     * Two doors. A browser upgrades and joins; the Worker that served an
     * Agent's `documents.write` knocks with markdown, because the room lives
     * here and a write it never hears about is a write its next quiet would
     * undo (ADR-0021, `LiveRooms`).
     */
    const url = new URL(request.url);
    if (url.pathname === "/read" || url.pathname === "/apply") {
      const name = url.searchParams.get("room") ?? "";
      const open = this.#server().documents.get(name);
      if (!open) return new Response(null, { status: 204 });
      if (url.pathname === "/read") return new Response(markdownOf(open));
      loadMarkdown(open, await request.text());
      return new Response(null, { status: 204 });
    }

    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("This endpoint is a WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    serveRoomSocket(this.#server(), roomSocket(server), request);
    return new Response(null, { status: 101, webSocket: client } as UpgradeInit);
  }
}

/*
 * The rooms of this deployment, as `documents.write` needs them: one Durable
 * Object per room, asked over its own fetch. A room nobody has open answers 204
 * and the caller falls back to the stored state (ADR-0021).
 */
export function workerLiveRooms(rooms: DurableObjectBinding): LiveRooms {
  const stub = (room: string) => rooms.get(rooms.idFromName(room));
  return {
    read: async (room) => {
      const answer = await stub(room).fetch(
        new Request(`https://room/read?room=${encodeURIComponent(room)}`),
      );
      return answer.status === 204 ? null : await answer.text();
    },
    apply: async (room, markdown) => {
      await stub(room).fetch(
        new Request(`https://room/apply?room=${encodeURIComponent(room)}`, {
          method: "POST",
          body: markdown,
        }),
      );
    },
  };
}

/*
 * What Cloudflare hands a Durable Object, narrowed to what this one uses. The
 * types are written out rather than imported from `@cloudflare/workers-types`
 * for the same reason `worker.ts` writes out its Cron Trigger's: this file is
 * compiled beside the SPA, and pulling the Workers globals in would put them
 * on the browser too.
 */
interface DurableObjectState {
  id: { toString(): string };
}

/** One end stays here and one end goes back in the 101 (Cloudflare's own API). */
interface CloudflareSocket extends RuntimeSocket {
  accept(): void;
}
declare const WebSocketPair: new () => { 0: CloudflareSocket; 1: CloudflareSocket };

/** `webSocket` on a 101 is Cloudflare's; the standard `ResponseInit` has no such field. */
interface UpgradeInit extends ResponseInit {
  webSocket: CloudflareSocket;
}
