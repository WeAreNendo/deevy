/**
 * Sends the browser to another site — a tool's own consent or install page —
 * which comes back to deevy on its own (account-links.ts, `sockets.install`).
 *
 * One function, so a test can say where deevy would have gone without jsdom
 * trying to go there.
 */
export function leaveFor(url: string): void {
  window.location.assign(url);
}
