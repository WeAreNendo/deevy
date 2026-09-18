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
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

/** Long enough for a slow instance, short enough not to be the thing you wait on. */
const ASK_TIMEOUT_MS = 5000;

export async function fetchCapabilities(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Capabilities> {
  // Nobody asked for this request, so it must not be the one that hangs: a
  // black-holed host would otherwise stall every command before the command.
  const res = await fetchImpl(`${origin}/api/spec.json`, {
    signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(
      `${origin} did not say what it can do (its API document answered ${String(res.status)}). ` +
        `Is that a deevy?`,
    );
  }
  const spec = (await res.json().catch(() => null)) as { info?: { version?: string } } | null;
  const operations = spec ? operationsIn(spec) : [];
  // An empty list is not an answer, it is a different service answering. A
  // typo'd origin landing on some other JSON, or a gateway returning 200 with
  // `{"message":"Forbidden"}`, would otherwise be cached for a day and refuse
  // every command in the CLI with complete confidence. Throwing here is what
  // makes the caller fail open, which is the right way round: garbage that
  // parses is likelier than a host that refuses to answer.
  if (operations.length === 0) {
    throw new Error(
      `${origin} answered, but not with an API document deevy would serve. Is that a deevy?`,
    );
  }
  const version = spec?.info?.version;
  return {
    operations,
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
      .then((raw) => JSON.parse(raw) as unknown)
      .catch(() => null);
    // Checked rather than cast: a file of the wrong shape used to reach the
    // filter and fail there as "Cannot read properties of undefined", which
    // tells nobody that a cache file is involved. A version of this CLI that
    // writes a different shape lands here too.
    if (usable(cached)) {
      const age = now - cached.readAt;
      // A negative age is a clock that was wrong when this was written, or a
      // config directory carried from another machine — it would otherwise
      // pin the cache for as long as the difference lasts.
      if (age >= 0 && age < CAPABILITIES_TTL_MS) return cached;
    }
  }
  const fresh = await fetchCapabilities(origin, options.fetchImpl ?? fetch);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Not a secret — it is the document the instance serves to anybody — so the
  // mode is ordinary, unlike the token beside it. The temp-and-rename is the
  // same though, for the other two reasons it is there: it will not write
  // through a symlink somebody left in the way, and two CLIs running at once
  // cannot interleave into a half-written file.
  const temporary = `${path}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(fresh, null, 2)}\n`, { flag: "wx" })
    .then(() => rename(temporary, path))
    // An unwritable config directory costs a request per command and nothing
    // else, which is worth less than failing the command over it.
    .catch(() => rm(temporary, { force: true }).catch(() => {}));
  return fresh;
}

function usable(cached: unknown): cached is Capabilities {
  const maybe = cached as Capabilities | null;
  return (
    maybe !== null &&
    typeof maybe === "object" &&
    Array.isArray(maybe.operations) &&
    typeof maybe.readAt === "number"
  );
}

/** What to say when somebody types a command this instance does not have. */
export function missingFrom(
  operation: string,
  words: string[],
  origin: string,
  capabilities: Capabilities,
  cliVersion: string,
): string {
  const said = `${origin} has no \`${operation}\`, so \`deevy ${words.join(" ")}\` is not something it can do.`;
  if (!capabilities.version) {
    return `${said}\nThis CLI is ${cliVersion}; that deevy did not say which version it is.`;
  }
  // Which way round the mismatch is, rather than the usual guess. An instance
  // that is not older has dropped the operation, and telling somebody to
  // upgrade it would be the opposite of the fix.
  const older = compareVersions(capabilities.version, cliVersion) < 0;
  return older
    ? `${said}\nThis CLI is ${cliVersion} and deevy ${capabilities.version} is older than the operation. Upgrade the instance, or use a CLI that matches it.`
    : `${said}\nThis CLI is ${cliVersion} and deevy ${capabilities.version} no longer has it. Upgrade the CLI.`;
}

/** Enough of semver to say which of two deevys is the earlier one. */
function compareVersions(left: string, right: string): number {
  const parts = (version: string) =>
    version.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : -1));
  const a = parts(left);
  const b = parts(right);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
