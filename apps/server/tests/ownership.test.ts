import { describe, expect, it } from "vite-plus/test";
import { NONROOT, takeOwnership, type Entry, type OwnershipFs } from "../src/ownership.ts";

/**
 * A file system as a map, so every decision the entrypoint makes as root is
 * asked here without root. What the kernel does with them is the smoke's
 * (scripts/smoke-image.ts), against a real container and real volumes.
 */
function fakeFs(entries: Record<string, Partial<Entry> & Pick<Entry, "uid">>): OwnershipFs & {
  chowned: string[];
  refuse: Set<string>;
} {
  const table = new Map(
    Object.entries(entries).map(([path, entry]) => [
      path,
      { gid: entry.uid, kind: "file", nlink: 1, ...entry } as Entry,
    ]),
  );
  const chowned: string[] = [];
  const refuse = new Set<string>();
  return {
    chowned,
    refuse,
    lstat: (path) => table.get(path),
    lchown(path, uid, gid) {
      if (refuse.has(path)) throw new Error(`EPERM: operation not permitted, lchown '${path}'`);
      chowned.push(`${path} ${String(uid)}:${String(gid)}`);
      table.set(path, { ...table.get(path)!, uid, gid });
    },
  };
}

const db = "/data/deevy.sqlite";
const code = { code: "/app" };
const dir = (uid: number, gid = uid): Partial<Entry> & Pick<Entry, "uid"> => ({
  uid,
  gid,
  kind: "directory",
});

describe("who the image's process becomes", () => {
  it("is 65532 on a fresh named volume, with nothing to give", () => {
    // The image makes /data 65532's, and a new volume copies it.
    const fs = fakeFs({ "/data": dir(NONROOT) });
    const taken = takeOwnership(db, fs, code);
    expect(taken.owner).toEqual({ uid: NONROOT, gid: NONROOT });
    expect(fs.chowned).toEqual([]);
  });

  it("is 65532 on a volume root wrote, which it takes with every file of the database", () => {
    // What releases before 0.8 left, and what Docker makes of a missing host path.
    const fs = fakeFs({
      "/data": dir(0),
      [db]: { uid: 0 },
      [`${db}-wal`]: { uid: 0 },
      [`${db}-shm`]: { uid: 0 },
    });
    const taken = takeOwnership(db, fs, code);
    expect(taken.owner).toEqual({ uid: NONROOT, gid: NONROOT });
    expect(fs.chowned).toEqual([
      "/data 65532:65532",
      `${db} 65532:65532`,
      `${db}-wal 65532:65532`,
      `${db}-shm 65532:65532`,
    ]);
  });

  it("is whoever owns a host directory, whose files stay theirs", () => {
    const fs = fakeFs({ "/data": dir(1000), [db]: { uid: 1000 }, [`${db}-wal`]: { uid: 1000 } });
    const taken = takeOwnership(db, fs, code);
    expect(taken.owner).toEqual({ uid: 1000, gid: 1000 });
    expect(taken.because).toBe("who owns /data");
    expect(fs.chowned).toEqual([]);
  });

  it("leaves a file's group alone when its owner is already right", () => {
    const fs = fakeFs({ "/data": dir(1000), [db]: { uid: 1000, gid: 100 } });
    takeOwnership(db, fs, code);
    expect(fs.chowned).toEqual([]);
  });

  it("does not take root's group with a directory's owner", () => {
    const fs = fakeFs({ "/data": dir(1000, 0) });
    expect(takeOwnership(db, fs, code).owner).toEqual({ uid: 1000, gid: 1000 });
  });

  it("gives a database a root sidecar restored to the directory's owner", () => {
    // The restore in docs/OPERATIONS.md, without the chown it used to need.
    const fs = fakeFs({ "/data": dir(NONROOT), [db]: { uid: 0 } });
    takeOwnership(db, fs, code);
    expect(fs.chowned).toEqual([`${db} 65532:65532`]);
  });

  it("gives nothing it would reach through a link or a second name", () => {
    // Whoever could write /data could plant either, and this runs as root.
    const fs = fakeFs({
      "/data": dir(0),
      [db]: { uid: 0, kind: "other" },
      [`${db}-wal`]: { uid: 0, nlink: 2 },
    });
    const taken = takeOwnership(db, fs, code);
    expect(fs.chowned).toEqual(["/data 65532:65532"]);
    expect(taken.skipped).toEqual([db, `${db}-wal`]);
  });

  it("never gives away the directory deevy's code is in, nor anything above it", () => {
    for (const path of ["/app/deevy.sqlite", "/deevy.sqlite"]) {
      const fs = fakeFs({ "/app": dir(0), "/": dir(0), [path]: { uid: 0 } });
      const taken = takeOwnership(path, fs, code);
      expect(taken.owner).toEqual({ uid: NONROOT, gid: NONROOT });
      expect(fs.chowned).toEqual([]);
    }
  });

  it("is 65532 with nothing touched for a database in memory or a directory that is not there", () => {
    const fs = fakeFs({ "/app": dir(0) });
    expect(takeOwnership(":memory:", fs, code).owner).toEqual({ uid: NONROOT, gid: NONROOT });
    expect(takeOwnership(db, fs, code).owner).toEqual({ uid: NONROOT, gid: NONROOT });
    expect(fs.chowned).toEqual([]);
  });

  it("carries on past what it may not give, and says so", () => {
    // A root-squashed NFS export: root may not chown, and the process it
    // becomes finds out from openDatabase whether that matters.
    const fs = fakeFs({ "/data": dir(0), [db]: { uid: 0 } });
    fs.refuse.add("/data");
    const taken = takeOwnership(db, fs, code);
    expect(taken.refused).toEqual([
      { path: "/data", error: "EPERM: operation not permitted, lchown '/data'" },
    ]);
    expect(fs.chowned).toEqual([`${db} 65532:65532`]);
  });
});
