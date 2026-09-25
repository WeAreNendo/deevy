import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspace } from "@deevy/db";
import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";
import { mountSpa, openDatabase } from "../src/node/index.ts";

const migrationsFolder = new URL("../../db/drizzle", import.meta.url).pathname;

describe("node adapters", () => {
  it("opens an in-memory database with migrations applied and foreign keys on", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    await db.insert(workspace).values({ id: "w1", name: "deevy", slug: "deevy" });
    expect((await db.query.workspace.findMany()).map((w) => w.slug)).toEqual(["deevy"]);
    const [pragma] = await db.all<{ foreign_keys: number }>("PRAGMA foreign_keys");
    expect(pragma?.foreign_keys).toBe(1);
    close();
  });

  /**
   * A database it can read and not write is the shape an upgrade leaves behind:
   * the image runs as uid 65532 and every file an earlier release wrote belongs
   * to root. SQLite does not fail a `journal_mode` it cannot honour — it stays
   * in `delete` and says nothing — so without this the server starts, answers
   * /healthz, reports healthy, and fails on the first write anybody attempts.
   *
   * Both halves are here because they fail differently: a database that is not
   * there yet cannot be created at all, and one that is there opens and lies.
   */
  it("refuses a directory it cannot create the database in", async () => {
    const dir = await mkdtemp(join(tmpdir(), "deevy-readonly-"));
    await chmod(dir, 0o555);
    try {
      expect(() => openDatabase({ path: join(dir, "deevy.sqlite"), migrationsFolder })).toThrow(
        /is not writable/,
      );
    } finally {
      await chmod(dir, 0o755);
    }
  });

  it("refuses a database it can read but not write, and says whose it must be", async () => {
    const dir = await mkdtemp(join(tmpdir(), "deevy-readonly-"));
    const path = join(dir, "deevy.sqlite");
    // Left behind by a run that could write, the way an upgrade finds it.
    openDatabase({ path, migrationsFolder }).close();
    await chmod(dir, 0o555);
    try {
      expect(() => openDatabase({ path, migrationsFolder })).toThrow(
        new RegExp(`chown -R ${String(process.getuid?.())}`),
      );
    } finally {
      await chmod(dir, 0o755);
    }
  });

  it("serves files and falls back to index.html", async () => {
    const dir = await mkdtemp(join(tmpdir(), "deevy-spa-"));
    await writeFile(join(dir, "index.html"), "<h1>spa</h1>");
    await writeFile(join(dir, "app.js"), "console.log(1)");
    const app = new Hono();
    mountSpa(app, dir);
    expect(await (await app.request("/app.js")).text()).toBe("console.log(1)");
    expect(await (await app.request("/issues/DEV-42")).text()).toBe("<h1>spa</h1>");
  });

  it("has the page asked for again each time, and a hashed asset kept for good", async () => {
    const dir = await mkdtemp(join(tmpdir(), "deevy-spa-"));
    await writeFile(join(dir, "index.html"), "<h1>spa</h1>");
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "assets", "index-3SdJuIbB.js"), "console.log(1)");
    const app = new Hono();
    mountSpa(app, dir);

    // With no header at all a browser guesses from Last-Modified, and the first
    // real GitHub walk kept running the page from before an upgrade: a new
    // build is only a new build once the page that names it is asked for.
    for (const path of ["/", "/index.html", "/settings/sockets/sock_1"]) {
      expect((await app.request(path)).headers.get("cache-control")).toBe("no-cache");
    }
    // What the page names is content-hashed, so a name never changes meaning.
    expect((await app.request("/assets/index-3SdJuIbB.js")).headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });
});
