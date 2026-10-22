/**
 * Who the image's process becomes, and what it hands to that user first
 * (ADR-0033). The entrypoint (entrypoint.ts) starts as root, asks
 * `takeOwnership`, then drops to the user it answers for good — so this is the
 * only code in deevy that decides anything as root, and it touches as little as
 * it can: the database's directory when root owns it, and the database's own
 * files when somebody else wrote them. Nothing else in the directory, nothing
 * through a link, and never the directory deevy's code is in.
 *
 * The file system is passed in so that every decision is tested without root
 * (tests/ownership.test.ts); scripts/smoke-image.ts runs the real thing in a
 * container.
 */
import { dirname, sep } from "node:path";

/** The base image's `nonroot`: who deevy runs as unless the directory says otherwise. */
export const NONROOT = 65532;

export interface Owner {
  uid: number;
  gid: number;
}

export interface Entry {
  uid: number;
  gid: number;
  kind: "directory" | "file" | "other";
  /** Hard links to it: a file named twice is given to nobody. */
  nlink: number;
}

/** What `takeOwnership` asks of the file system: node:fs in the image, a map in the tests. */
export interface OwnershipFs {
  /** What is at `path`, following no link; `undefined` when nothing is, or it cannot be asked. */
  lstat(path: string): Entry | undefined;
  /** Throws when it cannot, as `lchownSync` does. */
  lchown(path: string, uid: number, gid: number): void;
}

export interface Ownership {
  owner: Owner;
  /** Why it is that user, finishing the sentence the entrypoint logs. */
  because: string;
  /** What was given to `owner`. */
  given: string[];
  /** What could not be, and why: left for openDatabase to judge as `owner`. */
  refused: Array<{ path: string; error: string }>;
  /** Left alone because it was not a plain file with one name. */
  skipped: string[];
}

/**
 * Who deevy runs as, for a database at `databasePath` (absolute), and the
 * files given to that user so that it can write them:
 *
 * - The directory belongs to someone other than root — a fresh named volume
 *   (the image makes /data 65532's), or a host directory somebody made: deevy
 *   runs as that user and group, and their files stay theirs. A group of root is
 *   not taken with it; the user's own number stands in.
 * - It belongs to root — Docker made the mount point, or a release before 0.8
 *   wrote the volume: deevy runs as 65532 and the directory is given to it.
 *
 * Either way the database, its `-wal`, `-shm` and `-journal` are given to that
 * user when another wrote them, which is what a restore from a root sidecar
 * leaves. `code` is the directory deevy's code is in, which is never given
 * away, nor anything above it: whoever owns it could change what the next
 * start runs as root.
 */
export function takeOwnership(
  databasePath: string,
  fs: OwnershipFs,
  { code }: { code: string },
): Ownership {
  const nonroot = { uid: NONROOT, gid: NONROOT };
  const nothing = { given: [], refused: [], skipped: [] };
  if (databasePath === ":memory:") {
    return { owner: nonroot, because: "the image's own user", ...nothing };
  }
  const directory = dirname(databasePath);
  const holdsCode = directory === sep || `${code}${sep}`.startsWith(`${directory}${sep}`);
  const dir = fs.lstat(directory);
  if (dir?.kind !== "directory") {
    return {
      owner: nonroot,
      because: `the image's own user: there is no ${directory}`,
      ...nothing,
    };
  }
  const result: Ownership = { owner: nonroot, because: "", given: [], refused: [], skipped: [] };
  const give = (path: string): void => {
    try {
      fs.lchown(path, result.owner.uid, result.owner.gid);
      result.given.push(path);
    } catch (error) {
      result.refused.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  };
  if (dir.uid !== 0) {
    result.owner = { uid: dir.uid, gid: dir.gid === 0 ? dir.uid : dir.gid };
    result.because = `who owns ${directory}`;
  } else if (holdsCode) {
    result.because = `the image's own user: ${directory} holds deevy's code, so it stays root's`;
    return result;
  } else {
    result.because = `the image's own user, now that ${directory} is no longer root's`;
    give(directory);
  }
  for (const path of [databasePath, ...["-wal", "-shm", "-journal"].map((s) => databasePath + s)]) {
    const entry = fs.lstat(path);
    if (!entry || entry.uid === result.owner.uid) continue;
    if (entry.kind !== "file" || entry.nlink !== 1 || holdsCode) result.skipped.push(path);
    else give(path);
  }
  return result;
}
