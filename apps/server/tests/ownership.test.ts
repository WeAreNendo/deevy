import { describe, expect, it } from "vite-plus/test";
import { NONROOT, takeOwnership, type Opened, type OwnershipFs } from "../src/ownership.ts";

interface FakeEntry {
  uid: number;
  kind?: Opened["kind"] | "link";
  nlink?: number;
  /** The volume unless said otherwise; 1 is the image's own file system. */
  dev?: number;
  /** What open() throws instead of opening it, as an errno code; "chown" fails the chown instead. */
  refuses?: string;
}

const IMAGE = 1;
const VOLUME = 2;

/**
 * A file system as a map, so every decision the entrypoint makes as root is
 * asked here without root. What the kernel does with them is the smoke's
 * (scripts/smoke-image.ts), against a real container and real volumes.
 */
function fakeFs(
  entries: Record<string, FakeEntry>,
  links: Record<string, string> = {},
): OwnershipFs & { chowned: string[]; open: OwnershipFs["open"] } {
  const chowned: string[] = [];
  const fail = (code: string, path: string): never => {
    throw Object.assign(new Error(`${code}: ${path}`), { code });
  };
  return {
    chowned,
    rootDevice: IMAGE,
    realpath: (path) => links[path] ?? (entries[path] ? path : fail("ENOENT", path)),
    open(path, kind) {
      const entry = entries[path] ?? fail("ENOENT", path);
      if (entry.refuses && entry.refuses !== "chown") fail(entry.refuses, path);
      if (entry.kind === "link") fail("ELOOP", path);
      if (kind === "directory" && entry.kind !== "directory") fail("ENOTDIR", path);
      return {
        uid: entry.uid,
        dev: entry.dev ?? VOLUME,
        nlink: entry.nlink ?? 1,
        kind: (entry.kind ?? "file") as Opened["kind"],
        chown(uid, gid) {
          if (entry.refuses === "chown") fail("EPERM", path);
          chowned.push(`${path} ${String(uid)}:${String(gid)}`);
          entry.uid = uid;
        },
        close() {},
      };
    },
  };
}

const db = "/data/deevy.sqlite";
const dir = (uid: number, more: Partial<FakeEntry> = {}): FakeEntry => ({
  uid,
  kind: "directory",
  ...more,
});

describe("what the image's entrypoint gives to 65532 before it drops root", () => {
  it("gives nothing on a fresh named volume, which is 65532's already", () => {
    // The image makes /data 65532's, and a new volume copies it.
    const fs = fakeFs({ "/data": dir(NONROOT) });
    expect(takeOwnership(db, fs)).toEqual({ given: [], refused: [], skipped: [] });
    expect(fs.chowned).toEqual([]);
  });

  it("gives a volume root wrote, with every file of the database", () => {
    // What releases before 0.8 left, and what Docker makes of a missing host path.
    const fs = fakeFs({
      "/data": dir(0),
      [db]: { uid: 0 },
      [`${db}-wal`]: { uid: 0 },
      [`${db}-shm`]: { uid: 0 },
    });
    takeOwnership(db, fs);
    expect(fs.chowned).toEqual([
      "/data 65532:65532",
      `${db} 65532:65532`,
      `${db}-wal 65532:65532`,
      `${db}-shm 65532:65532`,
    ]);
  });

  it("gives a host directory somebody made to 65532, not them to deevy", () => {
    // Running as its owner would make a container escape that user on the
    // host, who owns a home and a shell profile (ADR-0033).
    const fs = fakeFs({ "/data": dir(1000), [db]: { uid: 1000 } });
    takeOwnership(db, fs);
    expect(fs.chowned).toEqual(["/data 65532:65532", `${db} 65532:65532`]);
  });

  it("gives a database a root sidecar restored", () => {
    // The restore in docs/OPERATIONS.md, without the chown it used to need.
    const fs = fakeFs({ "/data": dir(NONROOT), [db]: { uid: 0 } });
    takeOwnership(db, fs);
    expect(fs.chowned).toEqual([`${db} 65532:65532`]);
  });

  it("gives nothing that is a link, has a second name, or lives on another device", () => {
    // Whoever could write /data could plant any of them, and this runs as root.
    const fs = fakeFs({
      "/data": dir(0),
      [db]: { uid: 0, kind: "link" },
      [`${db}-wal`]: { uid: 0, nlink: 2 },
      [`${db}-shm`]: { uid: 0, dev: 7 },
      [`${db}-journal`]: { uid: 0, kind: "other" },
    });
    const taken = takeOwnership(db, fs);
    expect(fs.chowned).toEqual(["/data 65532:65532"]);
    expect(taken.skipped).toEqual([db, `${db}-wal`, `${db}-shm`, `${db}-journal`]);
  });

  it("gives nothing on the image's own file system, where the code and Node are", () => {
    for (const path of ["/app/dist/deevy.sqlite", "/nodejs/bin/deevy.sqlite", "/deevy.sqlite"]) {
      const parent = path.slice(0, path.lastIndexOf("/")) || "/";
      const fs = fakeFs({ [parent]: dir(0, { dev: IMAGE }), [path]: { uid: 0, dev: IMAGE } });
      const taken = takeOwnership(path, fs);
      expect(fs.chowned, path).toEqual([]);
      expect(taken.untouched, path).toBe(`${parent} is part of the image rather than a volume`);
    }
  });

  it("gives nothing in a directory reached through a link, wherever in the path it is", () => {
    // lstat and O_NOFOLLOW see the last part only; realpath sees all of them.
    const nested = "/data/a/b/deevy.sqlite";
    const fs = fakeFs({ "/data/a/b": dir(0), [nested]: { uid: 0 } }, { "/data/a/b": "/app/b" });
    const taken = takeOwnership(nested, fs);
    expect(fs.chowned).toEqual([]);
    expect(taken.untouched).toBe("/data/a/b is reached through a link, to /app/b");
  });

  it("gives nothing for a database in memory or a directory that is not there", () => {
    const fs = fakeFs({});
    expect(takeOwnership(":memory:", fs)).toEqual({ given: [], refused: [], skipped: [] });
    expect(takeOwnership(db, fs).untouched).toBe("there is no /data");
    expect(fs.chowned).toEqual([]);
  });

  it("carries on past what it may not give, and says so", () => {
    // A root-squashed NFS export, or a container without CAP_CHOWN: root may
    // not chown, and 65532 finds out from openDatabase whether that matters.
    const fs = fakeFs({
      "/data": dir(0, { refuses: "chown" }),
      [db]: { uid: 1000, refuses: "EACCES" },
      [`${db}-wal`]: { uid: 0 },
    });
    const taken = takeOwnership(db, fs);
    expect(taken.refused).toEqual([
      { path: "/data", error: "EPERM: /data" },
      { path: db, error: `EACCES: ${db}` },
    ]);
    expect(fs.chowned).toEqual([`${db}-wal 65532:65532`]);
  });
});
