import { REBUILT, roomGreeting } from "@deevy/core/room-handshake";
import { HocuspocusProvider } from "@hocuspocus/provider";
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
  /**
   * What this browser typed while it was away and the room could not take back
   * (`docs/adr/0021-*`). Null in every ordinary case: it is set only when a
   * rebuilt room and an offline tab changed the same lines, and it is here so
   * the screen can hand those words to the Human rather than drop them.
   */
  unmerged?: string | null;
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
 * Markdown, and only when a room needs it. Tiptap is the heaviest thing in the
 * SPA and `markdown-editor.tsx` goes to some trouble to keep it out of the
 * first load; a static import here would undo that for every page.
 */
let editor: Promise<typeof import("@deevy/editor")> | null = null;
const editorOnce = () => (editor ??= import("@deevy/editor"));

/**
 * A socket per room, and the room named in the URL.
 *
 * Hocuspocus can carry several Documents over one connection, and the first
 * draft of this did — but a room is a Durable Object, and the platform has to
 * know *which* object to route an upgrade to before any message has been sent.
 * So the name rides on the query string, one socket opens per room, and the
 * Worker routes each to its own object. On Node they all land on the same
 * in-process server and nothing about it matters (ADR-0021).
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
  const [status, setStatus] = useState<Room["status"]>("connecting");
  const providers = useRef(new Map<string, HocuspocusProvider>());
  /** When this browser was last in sync with each room, by its own clock. */
  const synced = useRef(new Map<string, number>());
  /** What each room said at that moment: the base a rebase merges against. */
  const held = useRef(new Map<string, string>());
  /** Words waiting to be put back into a room that was rebuilt while we were away. */
  const replay = useRef(new Map<string, { base: string; mine: string }>());
  const [unmerged, setUnmerged] = useState(new Map<string, string>());
  /** Bumped when a room is rebased, so the next render asks for a fresh one. */
  const [rebuilt, setRebuilt] = useState(0);

  useEffect(() => {
    const open = providers.current;
    return () => {
      for (const provider of open.values()) provider.destroy();
      open.clear();
    };
  }, []);

  const rooms = useMemo<Rooms>(() => {
    /*
     * The room was rebuilt while this browser was away, so what it holds cannot
     * be synced in — it shares no identities with the Document any more, and
     * Yjs would put both copies in one text. The stale document is dropped and
     * a fresh one asked for; the words typed offline go back in as markdown,
     * through the same three-way merge an Agent's write goes through.
     */
    const rebase = (name: string) => {
      const stale = providers.current.get(name);
      if (!stale) return;
      const was = held.current.get(name);
      void editorOnce().then(({ markdownOf }) => {
        const mine = markdownOf(stale.document);
        stale.destroy();
        providers.current.delete(name);
        synced.current.delete(name);
        held.current.delete(name);
        if (was !== undefined && was !== mine) replay.current.set(name, { base: was, mine });
        setRebuilt((count) => count + 1);
      });
    };

    /** The room has our text again; put back anything we typed while it did not. */
    const putBack = async (name: string, provider: HocuspocusProvider) => {
      const { loadMarkdown, markdownOf } = await editorOnce();
      synced.current.set(name, Date.now());
      held.current.set(name, markdownOf(provider.document));
      const want = replay.current.get(name);
      if (!want) return;
      replay.current.delete(name);
      const { mergeMarkdown } = await import("@deevy/core/merge");
      const theirs = markdownOf(provider.document);
      const merged = mergeMarkdown({ base: want.base, mine: want.mine, theirs });
      if (merged.ok) {
        if (merged.text !== theirs) loadMarkdown(provider.document, merged.text);
        return;
      }
      // The same lines, changed on both sides. The room keeps what it has —
      // overwriting somebody else's paragraph with a copy made offline is the
      // one thing none of this is allowed to do — and the Human gets their own
      // words back to place themselves.
      setUnmerged((before) => new Map(before).set(name, want.mine));
    };

    return {
      // Nothing is waited for: a room's socket is made when the room is asked
      // for, so there is no moment where the answer is "not yet".
      ready: true,
      roomFor: (name) => {
        if (!enabled) return null;
        let provider = providers.current.get(name);
        if (!provider) {
          const url = new URL(COLLAB_URL, window.location.origin);
          url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
          // The room in the URL, because the platform routes on it.
          url.searchParams.set("room", name);
          provider = new HocuspocusProvider({
            url: url.toString(),
            name,
            // The session on the upgrade is what authorises this. What the
            // token carries is how long ago this browser last had the room's
            // text, so a room rebuilt since can turn it away before a single
            // update moves (ADR-0021). Evaluated per attempt, so a reconnect
            // says how long it has really been.
            token: () => {
              const last = synced.current.get(name);
              return roomGreeting({
                syncedMsAgo: last === undefined ? null : Date.now() - last,
              });
            },
            // Scheduled, never straight away: the provider says "connecting"
            // from inside its own constructor, and the constructor runs while
            // whichever pane asked for the room is still rendering.
            onStatus: ({ status: became }) => {
              queueMicrotask(() => setStatus(became === "connected" ? "connected" : "connecting"));
            },
            onSynced: () => {
              const open = providers.current.get(name);
              if (open) void putBack(name, open);
            },
            onDisconnect: () => {
              // What the room said when we last had it. Everything typed from
              // here on is offline, and this is what it is a change to.
              const open = providers.current.get(name);
              if (open) {
                void editorOnce().then(({ markdownOf }) => {
                  held.current.set(name, markdownOf(open.document));
                });
              }
              queueMicrotask(() => setStatus("disconnected"));
            },
            onAuthenticationFailed: ({ reason }) => {
              if (reason === REBUILT) queueMicrotask(() => rebase(name));
            },
          });
          providers.current.set(name, provider);
        }
        return {
          doc: provider.document,
          awareness: provider.awareness!,
          status,
          unmerged: unmerged.get(name) ?? null,
        };
      },
      join: (name) => {
        const provider = providers.current.get(name);
        // Who is here, for everybody else's header and caret. Awareness is
        // ephemeral by design: leave, and this goes with you.
        if (provider && me) provider.awareness?.setLocalStateField("member", me);
      },
    };
    // `rebuilt` is not read by anything here: it is how a rebase asks for the
    // provider it just dropped to be made again.
  }, [status, me, enabled, unmerged, rebuilt]);

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
  /**
   * When an Agent wrote into this room, in milliseconds. An Agent never joins
   * one (ADR-0021) — the server says this on its behalf when it applies a
   * write, so a Human whose paragraphs just changed is told why.
   */
  wroteAt?: number;
}

/** How long an Agent's write is worth saying out loud. */
export const JUST_WROTE_MS = 12_000;

/** Everybody in the room, this browser included, without duplicates. */
export function presenceIn(room: Room | null): Present[] {
  if (!room) return [];
  const seen = new Map<string, Present>();
  for (const [clientId, state] of room.awareness.getStates()) {
    const entry = state as { member?: Omit<Present, "self">; wroteAt?: number };
    const member = entry.member;
    if (!member?.id) continue;
    const self = clientId === room.awareness.clientID;
    const already = seen.get(member.id);
    seen.set(member.id, {
      ...member,
      self: already ? already.self || self : self,
      ...(typeof entry.wroteAt === "number" ? { wroteAt: entry.wroteAt } : {}),
    });
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
