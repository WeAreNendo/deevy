import type { EmailMessage, EmailSender } from "@deevy/core/email";

/**
 * The development stand-in (`DEEVY_DEV_STUB_EMAIL=1`): it sends nothing and
 * keeps the last hundred emails in this process, which `/dev/email` on the
 * Node server shows, so a seeded instance and the acceptance walk can read
 * what deevy would have sent. An entry registers it only where it may, as with
 * the stub Socket; it is refused in production.
 */
const kept: Array<EmailMessage & { at: string }> = [];
const keep = 100;

export function createStubSender(): EmailSender {
  return {
    kind: "stub",
    send(message) {
      kept.unshift({ ...message, at: new Date().toISOString() });
      kept.length = Math.min(kept.length, keep);
      return Promise.resolve({ delivered: true, status: 200, id: `stub-${String(kept.length)}` });
    },
  };
}

/** What the stub was asked to send, newest first. */
export function stubOutbox(): ReadonlyArray<EmailMessage & { at: string }> {
  return kept;
}

/** Forgets everything, for a test that wants to start clean. */
export function clearStubOutbox(): void {
  kept.length = 0;
}
