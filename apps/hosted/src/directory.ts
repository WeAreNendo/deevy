/**
 * Which Workspaces there are, by slug: the one thing the router must know
 * before it wakes anything (docs/plans/hosted.md). `Platform` writes it when a
 * Workspace is provisioned, suspended or removed; the router only reads it.
 *
 * A slug that is not here is a 404 and never an object: `idFromName` would
 * happily create one for any name, and an object for every path somebody
 * tried would be an object for every scanner on the internet.
 */

/** Where a Workspace lives and whether it answers. */
export interface DirectoryEntry {
  /** The immutable name of its object; a Workspace's secrets derive from it too. */
  key: string;
  status: "active" | "suspended";
}

/**
 * A slug as a Workspace's path takes it: 3 to 40 lowercase letters, digits and
 * hyphens, starting and ending with a letter or digit.
 */
export function isSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(value);
}

/**
 * First segments that are never a Workspace's: the console's own pages, the
 * relay, and what any host answers at its root. The console checks a slug
 * against `Platform.available`, which reads this, before it takes one.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "about",
  "account",
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "billing",
  "blog",
  "cdn",
  "console",
  "deevy",
  "docs",
  "favicon.ico",
  "healthz",
  "help",
  "hooks",
  "invite",
  "login",
  "logout",
  "mcp",
  "new",
  "pricing",
  "relay",
  "robots.txt",
  "rpc",
  "settings",
  "signin",
  "signup",
  "static",
  "status",
  "support",
  "terms",
  "privacy",
  "welcome",
  "workspaces",
  "www",
]);

const prefix = "slug:";

/**
 * The entry for a slug, or null. Read through KV's edge cache for a minute:
 * a Workspace provisioned a moment ago may 404 on a cold edge for that long,
 * which is why the console sends its owner on only after `Platform` answered.
 */
export async function lookup(directory: KVNamespace, slug: string): Promise<DirectoryEntry | null> {
  if (!isSlug(slug) || RESERVED_SLUGS.has(slug)) return null;
  const entry = await directory.get<DirectoryEntry>(`${prefix}${slug}`, {
    type: "json",
    cacheTtl: 60,
  });
  return entry && typeof entry.key === "string" ? entry : null;
}

export async function record(
  directory: KVNamespace,
  slug: string,
  entry: DirectoryEntry,
): Promise<void> {
  await directory.put(`${prefix}${slug}`, JSON.stringify(entry));
}

export async function forget(directory: KVNamespace, slug: string): Promise<void> {
  await directory.delete(`${prefix}${slug}`);
}

/** Every slug in the directory, for a deploy that touches every Workspace. */
export async function slugs(directory: KVNamespace): Promise<string[]> {
  const found: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await directory.list({ prefix, ...(cursor ? { cursor } : {}) });
    found.push(...page.keys.map((key) => key.name.slice(prefix.length)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return found;
}
