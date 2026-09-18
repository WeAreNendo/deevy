/**
 * What the instance on the other end can actually do.
 *
 * The CLI ships with deevy and knows every operation the tree it was built from
 * has — which is the wrong list the moment somebody points a new CLI at an
 * older instance. deevy says what it has in the OpenAPI document it serves, so
 * the commands are narrowed to the intersection: one fetch, cached, and a
 * command the server does not have is hidden from `--help` and refused by name
 * rather than failing as a 404 somebody has to interpret.
 *
 * It is not a version check. Two instances on the same version have the same
 * operations, and comparing the operations is both stricter and kinder than
 * comparing numbers: it says which command is missing.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configDirectory, fileNameFor } from "./credentials.ts";

export interface Capabilities {
  /** Dotted operation names, as the instance's own document lists them. */
  operations: string[];
  /** What the instance calls itself, when its entry told it. */
  version: string | null;
  /** When this was read, so a stale answer can be noticed. */
  readAt: number;
}

/** A day: long enough not to be a per-command fetch, short enough to follow a deploy. */
export const CAPABILITIES_TTL_MS = 24 * 60 * 60 * 1000;

function cachePath(origin: string, dir: string): string {
  return join(dir, `${fileNameFor(origin).replace(/\.json$/, "")}.capabilities.json`);
}

export function operationsIn(spec: unknown): string[] {
  const paths = (spec as { paths?: Record<string, Record<string, { operationId?: string }>> })
    .paths;
  const found: string[] = [];
  for (const methods of Object.values(paths ?? {})) {
    for (const operation of Object.values(methods)) {
      if (operation.operationId) found.push(operation.operationId);
    }
  }
  return found.sort((a, b) => a.localeCompare(b));
}

export async function fetchCapabilities(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Capabilities> {
  const res = await fetchImpl(`${origin}/api/spec.json`);
  if (!res.ok) {
    throw new Error(
      `${origin} did not say what it can do (its API document answered ${String(res.status)}). ` +
        `Is that a deevy?`,
    );
  }
  const spec = (await res.json()) as { info?: { version?: string } };
  const version = spec.info?.version;
  return {
    operations: operationsIn(spec),
    // "0.0.0" is what an instance whose entry never told it its version serves,
    // and it is not a version — it is the absence of one.
    version: version && version !== "0.0.0" ? version : null,
    readAt: Date.now(),
  };
}

/**
 * The cached answer, or a fresh one.
 *
 * A miss costs one request and a hit costs a file read, so the common case —
 * a person running several commands against the instance they work in — pays
 * for the fetch once a day rather than once a command.
 */
export async function capabilitiesFor(
  origin: string,
  options: {
    fetchImpl?: typeof fetch;
    dir?: string;
    now?: number;
    /** Skip the cache, for `deevy whoami --refresh` and for a test. */
    refresh?: boolean;
  } = {},
): Promise<Capabilities> {
  const dir = options.dir ?? configDirectory();
  const now = options.now ?? Date.now();
  const path = cachePath(origin, dir);
  if (!options.refresh) {
    const cached = await readFile(path, "utf8")
      .then((raw) => JSON.parse(raw) as Capabilities)
      .catch(() => null);
    if (cached && now - cached.readAt < CAPABILITIES_TTL_MS) return cached;
  }
  const fresh = await fetchCapabilities(origin, options.fetchImpl ?? fetch);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Not a secret — it is the document the instance serves to anybody — so this
  // one is an ordinary file, unlike the token beside it.
  await writeFile(path, `${JSON.stringify(fresh, null, 2)}\n`).catch(() => {});
  return fresh;
}

/** What to say when somebody types a command this instance does not have. */
export function missingFrom(
  operation: string,
  words: string[],
  origin: string,
  capabilities: Capabilities,
  cliVersion: string,
): string {
  const named = capabilities.version ? `deevy ${capabilities.version}` : "that deevy";
  return (
    `${origin} has no \`${operation}\`, so \`deevy ${words.join(" ")}\` is not something it can do.\n` +
    `This CLI is ${cliVersion} and ${named} is older than the operation. Upgrade the instance, or use a CLI that matches it.`
  );
}
