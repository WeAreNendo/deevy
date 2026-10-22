/**
 * The image's entrypoint (ADR-0033). Started as root, which the image is, it
 * gives the database's directory to the user deevy will be (ownership.ts), then
 * becomes that user for good and runs the script it was handed: dist/index.mjs,
 * or whatever `docker run` names instead, such as dist/import.mjs. Started as
 * anyone else — `--user`, a Kubernetes `runAsUser` — it changes nothing and
 * runs the script as that user, and openDatabase says what to do if it cannot
 * write.
 *
 * It imports node builtins and ownership.ts and nothing else, and the script is
 * imported only once root is gone: static imports are evaluated first, so a
 * drop at the top of index.ts would come after the whole server had been
 * loaded as root.
 */
import { lchownSync, lstatSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { takeOwnership, type Owner, type OwnershipFs } from "./ownership.ts";

const [script, ...args] = process.argv.slice(2);
if (!script) {
  console.error(
    "Usage: node dist/entrypoint.mjs <script> [args...], as the image runs dist/index.mjs",
  );
  process.exit(2);
}

const nodeFs: OwnershipFs = {
  lstat(path) {
    try {
      const stat = lstatSync(path);
      const kind = stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
      return { uid: stat.uid, gid: stat.gid, kind, nlink: stat.nlink };
    } catch {
      return undefined;
    }
  },
  lchown: lchownSync,
};

/**
 * setuid(2) from root sets the real, effective and saved ids together, so
 * there is no way back. Asked anyway, because everything rests on it.
 */
function become({ uid, gid }: Owner): void {
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
    { code: resolve(dirname(fileURLToPath(import.meta.url)), "..") },
  );
  const { uid, gid } = ownership.owner;
  const who = `${String(uid)}:${String(gid)}`;
  for (const path of ownership.given) console.log(`gave ${path} to ${who}`);
  for (const { path, error } of ownership.refused) {
    console.warn(`could not give ${path} to ${who}: ${error}`);
  }
  for (const path of ownership.skipped) {
    console.warn(`left ${path} as it is: it is not a file with one name, so it is not given away`);
  }
  try {
    become(ownership.owner);
  } catch (error) {
    console.error(
      `deevy started as root and could not become ${who}: ${error instanceof Error ? error.message : String(error)}. ` +
        "It needs the SETUID and SETGID capabilities for that, which Docker grants unless they are dropped; " +
        `or start it as that user with --user ${who}.`,
    );
    process.exit(1);
  }
  console.log(`deevy runs as ${who}, ${ownership.because}`);
}

// The script sees the command line it would have had as the entrypoint itself.
const path = resolve(script);
process.argv = [process.argv[0]!, path, ...args];
await import(pathToFileURL(path).href);
