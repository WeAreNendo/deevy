import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

/**
 * A live Document, as a screen needs it (docs/plans/collaborative-documents.md,
 * ADR-0021): the text everybody in the room shares, who else is in it, and
 * whether this browser can still reach the server.
 */
export interface Room {
  doc: Y.Doc;
  awareness: Awareness;
  status: "connecting" | "connected" | "disconnected";
}

export interface Rooms {
  /**
   * The room for this name, or null where live Documents are not available.
   * Pure enough to call while rendering: it may make a provider, but it starts
   * nothing and tells React nothing.
   */
  roomFor: (name: string) => Room | null;
  /**
   * Start it: attach to the socket and say who is here. An effect's job, never
   * a render's — connecting is a state change, and React will not have one
   * component make those while another is rendering.
   */
  join?: (name: string) => void;
  /**
   * Whether the answer to "is there a room?" is final. An editor that mounted
   * without one and gained it a tick later would load its text twice — once
   * from the page and once from the room — so it waits for this instead.
   */
  ready: boolean;
}

/**
 * Null by default, which is the whole fallback: a deployment without rooms, a
 * test, and the first render before the socket exists all get editors that
 * behave exactly as they did before rooms (`documents.write` on blur, and a
 * save refused rather than landing on somebody else's).
 */
export const RoomsContext = createContext<Rooms>({ roomFor: () => null, ready: true });

/** Where a browser opens a room: the same origin the page came from, so the session travels. */
const COLLAB_URL = "/collab";

/**
 * One socket for the page, a room on it per Document. Hocuspocus multiplexes
 * several documents over one connection, which is why the socket is here and
 * the provider is per room: an Issue page has the description and two or three
 * Documents open at once, and four sockets would be four sign-ins.
 */
export function RoomsProvider({
  enabled,
  me,
  children,
}: {
  enabled: boolean;
  /** Who this browser is, for the caret and the avatars other people see. */
  me: { id: string; name: string; kind: "human" | "agent" } | null;
  children: ReactNode;
}) {
  const [socket, setSocket] = useState<HocuspocusProviderWebsocket | null>(null);
  const [status, setStatus] = useState<Room["status"]>("connecting");
  const providers = useRef(new Map<string, HocuspocusProvider>());
  const attached = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;
    const url = new URL(COLLAB_URL, window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const opened = new HocuspocusProviderWebsocket({
      url: url.toString(),
      onConnect: () => setStatus("connected"),
      onDisconnect: () => setStatus("disconnected"),
    });
    setSocket(opened);
    return () => {
      for (const provider of providers.current.values()) provider.destroy();
      providers.current.clear();
      attached.current.clear();
      opened.destroy();
      setSocket(null);
    };
  }, [enabled]);

  const rooms = useMemo<Rooms>(
    () => ({
      // Nothing is waited for where there are no rooms at all.
      ready: !enabled || socket !== null,
      roomFor: (name) => {
        if (!socket) return null;
        let provider = providers.current.get(name);
        if (!provider) {
          provider = new HocuspocusProvider({
            websocketProvider: socket,
            name,
            // The session on the upgrade is what authorises this; the token is
            // only what makes Hocuspocus ask, because a server with an
            // `onAuthenticate` waits to be told who is knocking.
            token: "session",
          });
          providers.current.set(name, provider);
        }
        return { doc: provider.document, awareness: provider.awareness!, status };
      },
      join: (name) => {
        const provider = providers.current.get(name);
        if (!provider || attached.current.has(name)) return;
        attached.current.add(name);
        // A provider handed a socket it did not make does not attach itself:
        // that is how one socket carries several Documents.
        provider.attach();
        // Who is here, for everybody else's header and caret. Awareness is
        // ephemeral by design: leave, and this goes with you.
        if (me) provider.awareness?.setLocalStateField("member", me);
      },
    }),
    [socket, status, me, enabled],
  );

  return <RoomsContext.Provider value={rooms}>{children}</RoomsContext.Provider>;
}

/** Whether the room question has an answer yet, for a screen that must not guess. */
export function useRoomsReady(): boolean {
  return useContext(RoomsContext).ready;
}

/**
 * The room for this Document, or null when there is none to join.
 *
 * Joining is an effect, never a render: asking for a room is what creates the
 * provider, and creating one tells the socket about it — a state change, which
 * React will not have a component make while another one is rendering.
 */
export function useRoom(name: string | undefined): Room | null {
  const rooms = useContext(RoomsContext);
  const [, redraw] = useState(0);
  const room = name ? rooms.roomFor(name) : null;

  // Rendering found the room; joining it is this effect's job.
  useEffect(() => {
    if (name) rooms.join?.(name);
  }, [name, rooms]);

  // Presence changes nothing about the text and everything about the header,
  // so the screen has to hear about it.
  useEffect(() => {
    if (!room) return;
    // Scheduled, not synchronous: the caret extension writes this browser's own
    // awareness while the editor is being created, and a redraw from inside
    // somebody else's render is what React refuses.
    const onChange = () => queueMicrotask(() => redraw((count) => count + 1));
    room.awareness.on("change", onChange);
    return () => room.awareness.off("change", onChange);
  }, [room]);

  return room;
}

/** A Member in a room, as awareness carries them. */
export interface Present {
  id: string;
  name: string;
  kind: "human" | "agent";
  /** This browser's own entry, which the screen does not draw as somebody else. */
  self: boolean;
}

/** Everybody in the room, this browser included, without duplicates. */
export function presenceIn(room: Room | null): Present[] {
  if (!room) return [];
  const seen = new Map<string, Present>();
  for (const [clientId, state] of room.awareness.getStates()) {
    const member = (state as { member?: Omit<Present, "self"> }).member;
    if (!member?.id) continue;
    const self = clientId === room.awareness.clientID;
    const already = seen.get(member.id);
    seen.set(member.id, { ...member, self: already ? already.self || self : self });
  }
  return [...seen.values()];
}

/** The name a room goes by on the wire, built the way the server parses it. */
export function roomFor(
  room:
    | { kind: "document"; issueKey: string; document: string }
    | { kind: "description"; issueKey: string },
): string {
  return room.kind === "document"
    ? `document:${room.issueKey}:${room.document}`
    : `description:${room.issueKey}`;
}
