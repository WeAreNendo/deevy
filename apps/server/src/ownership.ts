/**
 * What the image's entrypoint gives to 65532 before it drops root for good
 * (ADR-0033): the database's directory and the database's own files, when they
 * are not 65532's already, and nothing else. This is the only code in deevy
 * that changes anything as root, over a directory that a process which is not
 * root could have written, so it acts on what it opened rather than on a path
 * it checked: each file is opened without following a link, and only what that
 * descriptor turns out to be is given away. Nothing is given on the image's own
 * file system, so neither deevy's code nor Node can be handed to the process
 * that runs them.
 *
 * The file system is passed in so that every decision is tested without root
 * (tests/ownership.test.ts); scripts/smoke-image.ts runs the real thing.
 */
import { dirname } from "node:path";

/** The base image's `nonroot`, whom deevy always runs as when it starts as root. */
export const NONROOT = 65532;

/** An open file or directory: what it is, and a way to give that and nothing else away. */
export interface Opened {
  uid: number;
  dev: number;
  /** Hard links to it: a file with a second name is given to nobody. */
  nlink: number;
  kind: "directory" | "file" | "other";
  chown(uid: number, gid: number): void;
  close(): void;
}

/** What `takeOwnership` asks of the file system: node:fs in the image, a map in the tests. */
export interface OwnershipFs {
  /** The device the image's own files are on, which a volume is not. */
  rootDevice: number;
  /** `path` with every link in it resolved. Throws when there is nothing there. */
  realpath(path: string): string;
  /**
   * Opens `path` without following a link in its last part, as a directory
   * when asked for one. Throws as `openSync` does: `ENOENT` when nothing is
   * there, `ELOOP` for a link, `ENOTDIR` for a directory that is not one.
   */
  open(path: string, kind: "directory" | "file"): Opened;
}

export interface Ownership {
  /** What was given to 65532. */
  given: string[];
  /** What could not be, and why: left for openDatabase to judge as 65532. */
  refused: Array<{ path: string; error: string }>;
  /** Left as it was because it is not a file with one name on the volume. */
  skipped: string[];
  /** Why nothing in the directory was looked at, when nothing was. */
  untouched?: string;
}

const errorCode = (error: unknown): string | undefined => (error as { code?: string }).code;
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Gives `databasePath`'s directory (absolute) to 65532 when it is not 65532's,
 * and the database, its `-wal`, `-shm` and `-journal` likewise: what Docker
 * makes of a missing host path, a host directory somebody made, a volume a
 * release before 0.8 wrote, and a restore from a root sidecar. A directory
 * reached through a link, or one on the image's own file system, is left as it
 * is, and so is everything in it.
 */
export function takeOwnership(databasePath: string, fs: OwnershipFs): Ownership {
  const result: Ownership = { given: [], refused: [], skipped: [] };
  if (databasePath === ":memory:") return result;
  const directory = dirname(databasePath);
  let real: string;
  try {
    real = fs.realpath(directory);
  } catch {
    return { ...result, untouched: `there is no ${directory}` };
  }
  if (real !== directory) {
    return { ...result, untouched: `${directory} is reached through a link, to ${real}` };
  }
  let dir: Opened;
  try {
    dir = fs.open(directory, "directory");
  } catch (error) {
    return { ...result, untouched: `${directory} could not be opened: ${message(error)}` };
  }
  try {
    if (dir.dev === fs.rootDevice) {
      return { ...result, untouched: `${directory} is part of the image rather than a volume` };
    }
    const give = (path: string, opened: Opened): void => {
      try {
        opened.chown(NONROOT, NONROOT);
        result.given.push(path);
      } catch (error) {
        result.refused.push({ path, error: message(error) });
      }
    };
    if (dir.uid !== NONROOT) give(directory, dir);
    for (const path of [
      databasePath,
      ...["-wal", "-shm", "-journal"].map((s) => databasePath + s),
    ]) {
      let file: Opened;
      try {
        file = fs.open(path, "file");
      } catch (error) {
        if (errorCode(error) === "ELOOP") result.skipped.push(path);
        else if (errorCode(error) !== "ENOENT")
          result.refused.push({ path, error: message(error) });
        continue;
      }
      try {
        if (file.uid === NONROOT) continue;
        if (file.kind !== "file" || file.nlink !== 1 || file.dev !== dir.dev) {
          result.skipped.push(path);
        } else give(path, file);
      } finally {
        file.close();
      }
    }
    return result;
  } finally {
    dir.close();
  }
}
