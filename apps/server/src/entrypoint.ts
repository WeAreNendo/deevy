/**
 * The image's entrypoint (ADR-0033). Started as root, which the image is, it
 * gives the database's directory to 65532 (ownership.ts), then becomes 65532
 * for good and runs the script it was handed: dist/index.mjs, or whatever
 * `docker run` names instead, such as dist/import.mjs. Started as anyone else —
 * `--user`, a Kubernetes `runAsUser` — it changes nothing and runs the script
 * as that user, and openDatabase says what to do if it cannot write.
 *
 * It imports node builtins and ownership.ts and nothing else, which the image
 * smoke holds it to, and the script is imported only once root is gone: static
 * imports are evaluated first, so a drop at the top of index.ts would come
 * after the whole server had been loaded as root.
 */
import {
  closeSync,
  constants,
  fchownSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NONROOT, takeOwnership, type OwnershipFs } from "./ownership.ts";

const [script, ...args] = process.argv.slice(2);
if (!script) {
  console.error(
    "Usage: node dist/entrypoint.mjs <script> [args...], as the image runs dist/index.mjs",
  );
  process.exit(2);
}

const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK, O_DIRECTORY } = constants;

const nodeFs: OwnershipFs = {
  rootDevice: lstatSync("/").dev,
  realpath: (path) => realpathSync.native(path),
  open(path, kind) {
    // O_NONBLOCK so that a FIFO planted in place of the database cannot hold
    // the open forever; it is then refused for not being a file.
    const flags = O_RDONLY | O_NOFOLLOW | O_NONBLOCK | (kind === "directory" ? O_DIRECTORY : 0);
    const fd = openSync(path, flags);
    const stat = fstatSync(fd);
    return {
      uid: stat.uid,
      dev: stat.dev,
      nlink: stat.nlink,
      kind: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
      chown: (uid, gid) => fchownSync(fd, uid, gid),
      close: () => closeSync(fd),
    };
  },
};

/**
 * setuid(2) from root sets the real, effective and saved ids together, so
 * there is no way back. Asked anyway, because everything rests on it.
 */
function become(uid: number, gid: number): void {
  process.setgroups!([gid]);
  process.setgid!(gid);
  process.setuid!(uid);
  let regained = true;
  try {
    process.setuid!(0);
  } catch {
    regained = false;
  }
  if (regained || process.geteuid!() !== uid || process.getegid!() !== gid) {
    throw new Error(`it is still ${String(process.geteuid!())}:${String(process.getegid!())}`);
  }
}

if (process.getuid?.() === 0) {
  // The default env.ts falls back to, kept here rather than imported: env.ts
  // brings the core with it, which is not to be loaded as root.
  const databasePath = process.env.DEEVY_DATABASE_PATH ?? "./data/deevy.sqlite";
  const ownership = takeOwnership(
    databasePath === ":memory:" ? databasePath : resolve(databasePath),
    nodeFs,
  );
  const who = `${String(NONROOT)}:${String(NONROOT)}`;
  if (ownership.untouched) console.warn(`gave nothing to ${who}: ${ownership.untouched}`);
  for (const path of ownership.given) console.log(`gave ${path} to ${who}`);
  for (const { path, error } of ownership.refused) {
    console.warn(`could not give ${path} to ${who}: ${error}`);
  }
  for (const path of ownership.skipped) {
    console.warn(`left ${path} as it is: it is not a file with one name on the volume`);
  }
  try {
    become(NONROOT, NONROOT);
  } catch (error) {
    console.error(
      `deevy started as root and could not become ${who}: ${error instanceof Error ? error.message : String(error)}. ` +
        "It needs the SETUID and SETGID capabilities for that, which Docker grants unless they are dropped; " +
        `or start it as that user with --user ${who}.`,
    );
    process.exit(1);
  }
  // Docker set HOME for root. Nothing of deevy's reads it, but a dependency
  // that one day does should find a home it may write: the base image's own.
  process.env.HOME = "/home/nonroot";
  console.log(`deevy runs as ${who}`);
}

// The script sees the command line it would have had as the entrypoint itself.
const path = resolve(script);
process.argv = [process.argv[0]!, path, ...args];
await import(pathToFileURL(path).href);
