/**
 * The room, from outside it (ADR-0021). An Agent writes through the API, and
 * the API may be nowhere near where the room is running: in the same process on
 * Node, in a Durable Object somewhere else on Workers. Both answer the same two
 * questions, so `documents.write` does not have to know which it is talking to.
 *
 * Without one — a deployment with no rooms, or a room nobody has open — the
 * stored state is the truth and a write is a version, exactly as before.
 */
export interface LiveRooms {
  /** What the open room says right now, or null when nobody has it open. */
  read(room: string): Promise<string | null>;
  /**
   * Put this text into the open room, so every browser in it sees the change
   * arrive rather than finding out when it next loads the page.
   */
  apply(room: string, markdown: string): Promise<void>;
}
