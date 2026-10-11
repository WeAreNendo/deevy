import { isAppPath, underBase } from "@deevy/adapters/workers";
import { isSlug, RESERVED_SLUGS } from "./directory.ts";

/**
 * One data point per request in Workers Analytics Engine, indexed by the
 * Workspace it was for (docs/plans/hosted.md, C5): what a console shows of a
 * Workspace's use, what a plan will be billed by later, and where to look when
 * one Workspace is loud. Nothing personal goes in it — no address, no query,
 * no identity — only which Workspace, what kind of request, how it ended and
 * how long it took.
 */
export interface Meter {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
}

/** What a request was, by its path: a Workspace's API, its pages, its discovery, the relay or the console. */
export function kindOf(pathname: string): { slug: string; kind: string } {
  const discovery = /^\/\.well-known\/[^/]+\/([^/]+)/.exec(pathname);
  if (discovery?.[1] && isSlug(discovery[1])) return { slug: discovery[1], kind: "discovery" };
  const first = pathname.split("/")[1] ?? "";
  if (first === "auth") return { slug: "", kind: "relay" };
  if (first === "" || RESERVED_SLUGS.has(first) || !isSlug(first))
    return { slug: "", kind: "console" };
  const inner = underBase(pathname, `/${first}`) ?? "/";
  if (inner === "/api/live") return { slug: first, kind: "live" };
  return { slug: first, kind: isAppPath(inner) ? "app" : "page" };
}

/**
 * Written after the response is ready, and never allowed to fail it: a
 * metering outage is not a reason to turn a team away. A stream or a socket is
 * timed to its first byte, which is when this runs.
 */
export function meter(
  dataset: Meter | undefined,
  request: Request,
  response: Response,
  ms: number,
): void {
  if (!dataset) return;
  try {
    const { slug, kind } = kindOf(new URL(request.url).pathname);
    dataset.writeDataPoint({
      indexes: [slug || "-"],
      blobs: [kind, request.method, String(response.status)],
      doubles: [ms, 1],
    });
  } catch {
    // Dropped: the request already has its answer.
  }
}
