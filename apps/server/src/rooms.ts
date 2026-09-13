import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { roomSocket, serveRoomSocket, type RuntimeSocket } from "@deevy/core";
import type { Hocuspocus } from "@hocuspocus/server";
import { WebSocketServer } from "ws";

/** Where a browser opens a room. Same origin and same port as the API, so the session comes too. */
export const COLLAB_PATH = "/collab";

/**
 * Whatever `@hono/node-server` handed back: an HTTP or an HTTP/2 listener, and
 * all this needs of either is the upgrade it would otherwise drop.
 */
export interface UpgradableServer {
  on(
    event: "upgrade",
    listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
}

/**
 * The Node half of a room (ADR-0021). Node has no websocket server of its own,
 * so this is the one dependency only one runtime needs — the Worker is handed
 * a `WebSocketPair` by the platform and needs nothing.
 *
 * The upgrade is answered on the same listener as everything else rather than
 * on a port of its own: a room is joined with the session the page was loaded
 * with, and a cookie only travels to the origin it belongs to.
 */
export function serveRooms({ server, room }: { server: UpgradableServer; room: Hocuspocus }): {
  close: () => void;
} {
  const sockets = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== COLLAB_PATH) return;

    sockets.handleUpgrade(request, socket, head, (ws) => {
      serveRoomSocket(room, roomSocket(ws as unknown as RuntimeSocket), asRequest(request, url));
    });
  });

  // An upgraded socket is no longer the HTTP server's to close, so whoever
  // shuts the listener down has to be able to shut these too — or the process
  // waits for a browser tab that is not coming back.
  return {
    close: () => {
      for (const ws of sockets.clients) ws.terminate();
      sockets.close();
    },
  };
}

/**
 * The upgrade as a web-standard `Request`, which is what the room reads its
 * session from — the same object the Worker hands it, so both runtimes give
 * the hooks the same thing.
 */
function asRequest(request: IncomingMessage, url: URL): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) for (const one of value) headers.append(name, one);
  }
  return new Request(url, { headers });
}
