/**
 * The one thing a browser and a room say to each other before any Yjs update
 * moves (ADR-0021), kept in a module of its own because both ends need it and
 * one of them is the SPA: it must cost the browser bundle nothing, so it
 * imports nothing.
 *
 * A room is occasionally rebuilt from its markdown to stop its state growing
 * forever. That gives every piece of the Document a new identity, and two
 * documents that share no identities do not merge — they concatenate. So a
 * browser that was away across a rebuild says how long ago it last had the
 * room's text, and a room that was rebuilt since turns it away with `REBUILT`
 * rather than letting it sync the Document in twice.
 */

/** What a browser says when it knocks. */
export interface RoomGreeting {
  /**
   * Milliseconds since this browser was last in sync with the room, or null
   * when it holds nothing yet and so has nothing that could go stale. Elapsed
   * rather than a reading of the clock, because the two clocks are not the same
   * one and the difference between them is nobody's to guess.
   */
  syncedMsAgo: number | null;
}

/** Why a room turned a browser away: rebuilt while it was gone, so it must rebase. */
export const REBUILT = "room-rebuilt";

export function roomGreeting(said: RoomGreeting): string {
  return JSON.stringify(said);
}

/** What the browser said, or a browser holding nothing — which is what anything unreadable means. */
export function readRoomGreeting(token: string | undefined | null): RoomGreeting {
  if (!token) return { syncedMsAgo: null };
  try {
    const said = JSON.parse(token) as Partial<RoomGreeting>;
    const ago = said.syncedMsAgo;
    return { syncedMsAgo: typeof ago === "number" && ago >= 0 ? ago : null };
  } catch {
    // An older browser sent "session", and a browser holding nothing is the
    // safe reading of anything this cannot parse: it syncs as it always did.
    return { syncedMsAgo: null };
  }
}

/** The refusal a room throws, shaped the way Hocuspocus reads one. */
export class RoomRebuilt extends Error {
  readonly reason = REBUILT;
  constructor() {
    super("This Document was rebuilt while you were away; reopen it to put your words back.");
    this.name = "RoomRebuilt";
  }
}
