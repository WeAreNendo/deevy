import { spawn } from "node:child_process";
import type { DeevyClient } from "./client.ts";
import type { Reporter } from "./identity.ts";

/**
 * `deevy gates open` (ADR-0024, ADR-0010).
 *
 * The one thing a terminal can do about a Gate is put it in front of a Human.
 * Ruling happens in deevy's own browser, signed in as themselves — not through
 * an API key, not through a token they delegated to something else — so the
 * useful verb is `open` and there is no `approve` to write.
 *
 * What it takes is whatever somebody has to hand: the request id out of a
 * notification, or the tracker's own key for the record they were just
 * reading.
 */

/** Whether this is a Gate's own id, which needs no lookup. */
function isRequestId(ref: string): boolean {
  return /^gate_[0-9a-z]{12}$/.test(ref.trim());
}

export function gateUrl(webOrigin: string, requestId: string): string {
  return `${webOrigin.replace(/\/+$/, "")}/gates/${encodeURIComponent(requestId)}`;
}

/**
 * The Gate a reference names: the id as it stands, or the question still open
 * on that record — the newest of them, because a record on its second visit
 * has one Gate waiting and one that was ruled on.
 */
export async function resolveGateRef(client: DeevyClient, ref: string): Promise<string> {
  const trimmed = ref.trim();
  if (isRequestId(trimmed)) return trimmed;

  const record = await client.issues.get({ issue: trimmed });
  const { gates } = await client.gates.list({ issueId: record.id, status: "open", limit: 20 });
  const waiting = [...gates].sort((a, b) => b.askedAt.getTime() - a.askedAt.getTime())[0];
  if (!waiting) {
    throw new Error(`There is no Gate waiting on ${trimmed}.`);
  }
  return waiting.id;
}

const console_: Reporter = {
  out: (line) => {
    console.log(line);
  },
  err: (line) => {
    console.error(line);
  },
};

export async function openGate(
  origin: string,
  ref: string,
  options: {
    client: DeevyClient;
    webOrigin?: string;
    openBrowser?: boolean;
    report?: Reporter;
  },
): Promise<string> {
  const report = options.report ?? console_;
  const url = gateUrl(options.webOrigin ?? origin, await resolveGateRef(options.client, ref));
  report.err("A Gate is ruled in deevy, by a Human, in a browser.");
  report.out(url);
  if (options.openBrowser !== false) openInBrowser(url);
  return url;
}

/**
 * Best effort: a terminal on a server has no browser, and that is not an
 * error. The `error` listener is what keeps a missing opener from killing the
 * process — the URL is already printed by then (identity.ts says the rest).
 */
function openInBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const child = spawn(command, [url], { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}
