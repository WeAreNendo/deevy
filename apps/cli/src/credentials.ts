/**
 * Where a signed-in Human's token lives, and how the CLI decides who it is.
 *
 * One file per instance under `~/.config/deevy`, because somebody works in more
 * than one and a single file would make signing into the second sign the first
 * out. The file holds a bearer token, so it is written at 0600 and the
 * directory at 0700: the same care a shell gives an SSH key, for the same
 * reason.
 */
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** What the CLI is acting as, which is the first line of `deevy whoami`. */
export type Credential =
  | { kind: "key"; token: string; origin: string }
  | { kind: "token"; token: string; origin: string; expiresAt: number | null };

export interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds, or null when the server did not say. */
  expiresAt: number | null;
  /** The resource the token was minted for, kept so a stale one is recognisable. */
  resource: string;
}

/** `https://deevy.example.com:8443` becomes `deevy.example.com_8443`. */
export function fileNameFor(origin: string): string {
  const url = new URL(origin);
  return `${url.host.replace(/:/g, "_")}.json`;
}

export function configDirectory(): string {
  // XDG first, because somebody who set it meant it.
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "deevy");
}

export async function readToken(
  origin: string,
  dir = configDirectory(),
): Promise<StoredToken | null> {
  const raw = await readFile(join(dir, fileNameFor(origin)), "utf8").catch(() => null);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as StoredToken;
  } catch {
    // A file somebody edited by hand is not a crash: signing in again fixes it.
    return null;
  }
}

export async function writeToken(
  origin: string,
  token: StoredToken,
  dir: string = configDirectory(),
): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // `mkdir` respects the umask, so the mode is set again rather than asked for.
  await chmod(dir, 0o700).catch(() => {});
  const path = join(dir, fileNameFor(origin));
  await writeFile(path, `${JSON.stringify(token, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
  return path;
}

export async function forgetToken(
  origin: string,
  dir: string = configDirectory(),
): Promise<boolean> {
  const path = join(dir, fileNameFor(origin));
  const existed = (await readFile(path, "utf8").catch(() => null)) !== null;
  await rm(path, { force: true });
  return existed;
}

/** Every deevy this machine has signed into, by origin file name. */
export const apiKeyPrefix = "deevy_sk_";

/**
 * What the CLI will authenticate with, and why.
 *
 * An API key in the environment wins over a stored token: it is the explicit
 * thing somebody put there for this one invocation, usually in a script. It
 * also means the CLI is an Agent for that run, which changes what it may do —
 * so `whoami` says which of the two it used rather than leaving it to be
 * guessed (ADR-0016).
 */
export async function credentialFor(
  origin: string,
  environment: NodeJS.ProcessEnv = process.env,
  dir: string = configDirectory(),
): Promise<Credential | null> {
  const key = environment.DEEVY_API_KEY?.trim();
  if (key) return { kind: "key", token: key, origin };
  const stored = await readToken(origin, dir);
  if (!stored) return null;
  return { kind: "token", token: stored.accessToken, origin, expiresAt: stored.expiresAt };
}
