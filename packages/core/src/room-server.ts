import { Hocuspocus } from "@hocuspocus/server";
import { ORPCError } from "@orpc/server";
import type { Db } from "@deevy/db";
import type { AppContext, ContextFor } from "./operations/registry.ts";
import { loadMarkdown, markdownOf } from "@deevy/editor";
import type { Awareness } from "y-protocols/awareness";
import type { LiveRooms, Wrote } from "./live-rooms.ts";
import { openRoom, storeRoom } from "./room-store.ts";
import { authorizeRoom, type OpenedRoom, type Room } from "./rooms.ts";

/**
 * The room server: one live text per Document, and per Issue description, that
 * several Members may type in at once (docs/plans/collaborative-documents.md,
 * ADR-0021). Hocuspocus holds the Yjs documents and speaks the protocol; what
 * is deevy's is the hooks — who may join, and what a version is.
 *
 * It is not an operation and does not pretend to be one (ADR-0009 stands):
 * nothing travels over this socket but Yjs updates and awareness, and every
 * rule it applies is the one the Document's own operations apply.
 */
export interface RoomServerOptions {
  /**
   * The same context the rest of the app builds per request — `buildContext` in
   * `app.ts`, over the upgrade request's own headers, so a room is joined with
   * the session the page was loaded with. Injected rather than imported so a
   * test can hand over a caller without minting a session for them.
   */
  contextFrom: (request: Request) => Promise<AppContext>;
  /** Where a room's state and its versions are written. */
  db: Db;
  /**
   * How long a room has to be still before what is in it becomes a version.
   * Thirty seconds by default, and a cap so a Document nobody stops typing in
   * is still written down (ADR-0021).
   */
  quietMs?: number;
  atMostEveryMs?: number;
}

/** What every later hook is given about a connection. */
export interface RoomContext {
  member: ContextFor<"member">["member"];
  /** The room, as the rules resolved it: the Issue, and the Document when there is one. */
  opened: OpenedRoom;
  room: Room;
  issueKey: string;
  issueId: string;
  /** The Document's id, or null for an Issue's description. */
  documentId: string | null;
  /** The Workspace, for the log a version is written to. */
  workspaceId: string;
}

/** Hocuspocus hands this the document name and the upgrade request, and nothing else. */
export interface Joining {
  documentName: string;
  request: Request;
}

/**
 * Who may open this room, as a function, so it can be tested without a socket.
 * Throws the same refusals the operations throw: UNAUTHORIZED for a caller who
 * is no Member, FORBIDDEN for an Agent, NOT_FOUND for a room that is not ours.
 */
export function roomAuthenticator({ contextFrom }: Pick<RoomServerOptions, "contextFrom">) {
  return async ({ documentName, request }: Joining): Promise<RoomContext> => {
    const context = await contextFrom(request);
    if (!context.member || !context.workspace) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Sign in to open this Document",
      });
    }

    const opened = await authorizeRoom(context as ContextFor<"member">, documentName);
    return {
      member: context.member,
      opened,
      room: opened.room,
      issueKey: opened.issue.key,
      issueId: opened.issue.id,
      documentId: opened.document?.id ?? null,
      workspaceId: context.workspace.id,
    };
  };
}

/**
 * The server itself: the hooks above, wired to Hocuspocus, plus the two that
 * make a room a Document — what it opens holding, and what it writes when it
 * goes quiet.
 */
export function createRoomServer(options: RoomServerOptions): Hocuspocus {
  const authenticate = roomAuthenticator(options);
  const { db } = options;

  /*
   * Who has typed since the last version was cut, per room. Hocuspocus reports
   * the origin of the last transaction only, and a version belongs to
   * everybody whose words are in it — so the names are collected as they
   * arrive and drained when the room is written.
   */
  const typists = new Map<string, Set<string>>();
  const nameTypist = (documentName: string, memberId: string | undefined) => {
    if (!memberId) return;
    const names = typists.get(documentName) ?? new Set<string>();
    names.add(memberId);
    typists.set(documentName, names);
  };

  return new Hocuspocus({
    // Thirty seconds of stillness is a version; two minutes of typing without
    // one is too long to have written nothing down.
    debounce: options.quietMs ?? 30_000,
    maxDebounce: options.atMostEveryMs ?? 120_000,

    // Every connection authenticates; there is no anonymous room.
    onAuthenticate: (payload) =>
      authenticate({ documentName: payload.documentName, request: payload.request }),

    onLoadDocument: async ({ documentName, document, context }) => {
      const room = (context as RoomContext).opened;
      await openRoom({ db, room, doc: document });
      typists.delete(documentName);
      return document;
    },

    onChange: ({ documentName, context }) => {
      nameTypist(documentName, (context as RoomContext).member.id);
      return Promise.resolve();
    },

    onStoreDocument: async ({ documentName, document, lastContext, clientsCount }) => {
      const room = (lastContext as RoomContext).opened;
      const authors = [...(typists.get(documentName) ?? new Set<string>())];
      typists.delete(documentName);
      await storeRoom({
        db,
        room,
        doc: document,
        authors,
        now: new Date(),
        // Whether anybody is still in it, which is what decides a compaction:
        // the last browser leaving is the moment a Document's history can be
        // swept up without anybody holding the old one (ADR-0021).
        connections: clientsCount,
        // The Workspace the Issue belongs to: the Event goes in the same log
        // as every other write, because a version cut in a room is a write.
        log: { workspace: { id: (lastContext as RoomContext).workspaceId } },
      });
    },
  });
}

/**
 * The socket half of a connection, which every runtime spells differently: a
 * `ws` socket on Node, one end of a `WebSocketPair` in a Durable Object. All
 * the room needs is somewhere to send bytes and somewhere to hear them, so
 * that is all this asks for — and it is why the same room serves both.
 */
export interface RoomSocket {
  send(data: ArrayBuffer | Uint8Array | string): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
  /** Called by the runtime for each frame the client sent. */
  deliver?: (data: Uint8Array) => void;
  onClientClose?: () => void;
}

/**
 * The open rooms of this Hocuspocus instance, as `documents.write` needs them
 * (`live-rooms.ts`). Only rooms that are actually open: a name nobody has
 * connected to answers null, and the caller falls back to the stored state.
 */
export function liveRoomsOf(server: Hocuspocus): LiveRooms {
  const openDocument = (room: string) => server.documents.get(room) ?? null;
  return {
    read: (room) => {
      const document = openDocument(room);
      return Promise.resolve(document ? markdownOf(document) : null);
    },
    apply: (room, markdown, by) => {
      const document = openDocument(room);
      if (!document) return Promise.resolve();
      // Into the live document itself. Hocuspocus watches it, so every browser
      // in the room sees the Agent's paragraphs arrive where they are rather
      // than finding out when the page is next loaded.
      loadMarkdown(document, markdown);
      announceWrite(document, by);
      return Promise.resolve();
    },
  };
}

/**
 * The room says who just wrote into it, on their behalf. Awareness is the right
 * place for it — ephemeral, never a version, gone when the room closes — and
 * the timestamp rather than a timer is what makes it survive a Durable Object
 * being hibernated: the screen stops showing it, nobody has to unset it.
 */
export function announceWrite(document: { awareness?: Awareness }, by?: Wrote): void {
  if (!by || !document.awareness) return;
  document.awareness.setLocalState({ member: by, wroteAt: Date.now() });
}

/** What a runtime's own socket looks like: the WHATWG interface, as far as it goes. */
export interface RuntimeSocket {
  readyState: number;
  send(data: ArrayBuffer | Uint8Array | string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: never) => void): void;
}

/**
 * A `RoomSocket` over a runtime's own WebSocket: one end of a `WebSocketPair`
 * in a Durable Object, a `ws` socket on Node. Both dispatch `message` and
 * `close` events, and both hand the bytes over in whichever shape they feel
 * like — an `ArrayBuffer`, a view onto one — so this is where that is settled.
 */
export function roomSocket(ws: RuntimeSocket): RoomSocket {
  const socket: RoomSocket = {
    send: (data) => {
      ws.send(data);
    },
    close: (code, reason) => {
      ws.close(code, reason);
    },
    get readyState() {
      return ws.readyState;
    },
  };
  ws.addEventListener("message", ((event: { data: ArrayBuffer | Uint8Array | string }) => {
    const { data } = event;
    if (typeof data === "string") return;
    socket.deliver?.(data instanceof Uint8Array ? data : new Uint8Array(data));
  }) as (event: never) => void);
  ws.addEventListener("close", (() => {
    socket.onClientClose?.();
  }) as (event: never) => void);
  return socket;
}

/**
 * Hand a socket to the room. Hocuspocus does not listen to the socket itself —
 * `handleConnection` gives back a connection, and whoever owns the socket feeds
 * it (`handleMessage`, `handleClose`). That indirection is the whole reason one
 * room implementation runs on two runtimes, so this is the only place that
 * knows how the two are joined.
 */
export function serveRoomSocket(server: Hocuspocus, socket: RoomSocket, request: Request): void {
  const connection = server.handleConnection(socket, request);
  socket.deliver = (data) => {
    connection.handleMessage(data);
  };
  socket.onClientClose = () => {
    connection.handleClose();
  };
}
