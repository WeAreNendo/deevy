import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vite-plus/test";
import { checkMigrations } from "../scripts/check-migrations.ts";
import {
  projectDurableMigrations,
  projectMigrations,
  renderDurableMigrations,
} from "../scripts/emit-d1-migrations.ts";

const run = promisify(execFile);

/** A throwaway drizzle output folder holding the given migrations. */
async function drizzleFolder(migrations: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "deevy-drizzle-"));
  for (const [name, sql] of Object.entries(migrations)) {
    await mkdir(join(dir, name), { recursive: true });
    await writeFile(join(dir, name, "migration.sql"), sql);
  }
  return dir;
}

/**
 * The Durable Object projection the emitter would write for `drizzleDir`, so a
 * test about the D1 files hears about nothing else.
 */
async function currentDurableFile(drizzleDir: string) {
  const file = join(await mkdtemp(join(tmpdir(), "deevy-durable-")), "durable-migrations.ts");
  await writeFile(file, renderDurableMigrations(await projectDurableMigrations(drizzleDir)));
  return file;
}

describe("the D1 projection of a drizzle migration", () => {
  it("rewrites statement breakpoints into plain statement separation", async () => {
    const dir = await drizzleFolder({
      "20260101000000_one":
        "CREATE TABLE `a` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n" +
        "--> statement-breakpoint\n" +
        "CREATE INDEX `a_idx` ON `a` (`id`);",
    });

    expect(await projectMigrations(dir)).toEqual([
      {
        name: "0001_20260101000000_one.sql",
        sql: [
          "-- Generated from drizzle/20260101000000_one/migration.sql by `vp run db#generate:d1`.",
          "-- Edit packages/db/src/schema instead; wrangler applies this file to D1 (ADR-0008).",
          "",
          "CREATE TABLE `a` (",
          "\t`id` text PRIMARY KEY NOT NULL",
          ");",
          "",
          "CREATE INDEX `a_idx` ON `a` (`id`);",
          "",
        ].join("\n"),
      },
    ]);
  });
});

/**
 * Discovered by applying migrations to a local D1, not guessed: workerd runs
 * every batch inside a transaction, so `PRAGMA foreign_keys=OFF` — which
 * drizzle-kit wraps around every table rebuild, and which the Node migrator
 * honours at the connection — is accepted and silently ignored there. The
 * `DROP TABLE` in that window then cascades children away.
 */
describe("statements D1 will not take", () => {
  it("refuses a PRAGMA, naming the file and the line", async () => {
    const dir = await drizzleFolder({
      "20260101000000_rebuild":
        "CREATE TABLE `__new_a` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n" +
        "--> statement-breakpoint\n" +
        "PRAGMA foreign_keys=OFF;",
    });

    await expect(projectMigrations(dir)).rejects.toThrow(
      /drizzle\/20260101000000_rebuild\/migration\.sql:5\b.*PRAGMA/s,
    );
  });

  it("reads whole statements, not lines, so a trigger body is not transaction control", async () => {
    const dir = await drizzleFolder({
      "20260101000000_trigger":
        "CREATE TRIGGER `t` AFTER INSERT ON `a`\nBEGIN\n\tDELETE FROM `b`;\nEND;",
    });

    const [only] = await projectMigrations(dir);
    expect(only?.sql).toContain("CREATE TRIGGER `t` AFTER INSERT ON `a`");
  });

  /**
   * The rest of what a local D1 answered with an error rather than a row:
   * transaction control (workerd sends you to `state.storage.transaction()`),
   * ATTACH and DETACH (`SQLITE_AUTH`), and VACUUM ("cannot VACUUM from within
   * a transaction").
   */
  for (const statement of [
    "BEGIN;",
    "COMMIT;",
    "ROLLBACK;",
    "END;",
    "SAVEPOINT sp;",
    "RELEASE sp;",
    "ATTACH DATABASE 'other.db' AS other;",
    "DETACH DATABASE other;",
    "VACUUM;",
  ]) {
    it(`refuses ${statement}`, async () => {
      const dir = await drizzleFolder({
        "20260101000000_one": `CREATE TABLE \`a\` (\`id\` text PRIMARY KEY NOT NULL);\n--> statement-breakpoint\n${statement}`,
      });

      await expect(projectMigrations(dir)).rejects.toThrow(
        /20260101000000_one\/migration\.sql:3\b/,
      );
    });
  }
});

/**
 * The committed projection is a build artifact diffed in CI, like
 * openapi.json: what is in the repository must be what the emitter writes
 * today, or a deploy applies SQL nobody generated (ADR-0009).
 */
describe("packages/db/migrations", () => {
  const drizzleDir = new URL("../drizzle", import.meta.url).pathname;
  const migrationsDir = new URL("../migrations", import.meta.url).pathname;

  it("holds byte-for-byte what the emitter writes for the drizzle folders", async () => {
    const projected = await projectMigrations(drizzleDir);

    const committed = await Promise.all(
      projected.map(async ({ name }) => ({
        name,
        sql: await readFile(join(migrationsDir, name), "utf8"),
      })),
    );
    expect(committed).toEqual(projected);
    expect((await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort()).toEqual(
      projected.map(({ name }) => name),
    );
  });
});

/**
 * A stale projection is the one way a schema change can reach D1 wrong while
 * every other check is green, so it fails CI exactly like a stale
 * openapi.json.
 */
describe("check:migrations on the projection", () => {
  it("fails when a drizzle folder has no projected file", async () => {
    const dir = await drizzleFolder({
      "20260101000000_one": "CREATE TABLE `a` (`id` text PRIMARY KEY NOT NULL);",
    });
    const empty = await mkdtemp(join(tmpdir(), "deevy-migrations-"));
    const durableMigrationsFile = await currentDurableFile(dir);

    expect(
      await checkMigrations({ drizzleDir: dir, migrationsDir: empty, durableMigrationsFile }),
    ).toEqual([
      "packages/db/migrations/0001_20260101000000_one.sql is missing; run `vp run db#generate:d1`",
    ]);
  });

  it("fails when a projected file is not what the emitter would write today", async () => {
    const dir = await drizzleFolder({
      "20260101000000_one": "CREATE TABLE `a` (`id` text PRIMARY KEY NOT NULL);",
    });
    const stale = await mkdtemp(join(tmpdir(), "deevy-migrations-"));
    await writeFile(join(stale, "0001_20260101000000_one.sql"), "CREATE TABLE `b` (`id` text);\n");
    const durableMigrationsFile = await currentDurableFile(dir);

    expect(
      await checkMigrations({ drizzleDir: dir, migrationsDir: stale, durableMigrationsFile }),
    ).toEqual([
      "packages/db/migrations/0001_20260101000000_one.sql is stale; run `vp run db#generate:d1`",
    ]);
  });

  it("fails when a projected file has no drizzle folder behind it", async () => {
    const dir = await drizzleFolder({
      "20260101000000_one": "CREATE TABLE `a` (`id` text PRIMARY KEY NOT NULL);",
    });
    const orphaned = await mkdtemp(join(tmpdir(), "deevy-migrations-"));
    const [only] = await projectMigrations(dir);
    await writeFile(join(orphaned, only!.name), only!.sql);
    await writeFile(join(orphaned, "0002_20260102000000_gone.sql"), "DROP TABLE `a`;\n");
    const durableMigrationsFile = await currentDurableFile(dir);

    expect(
      await checkMigrations({ drizzleDir: dir, migrationsDir: orphaned, durableMigrationsFile }),
    ).toEqual([
      "packages/db/migrations/0002_20260102000000_gone.sql has no drizzle folder; run `vp run db#generate:d1`",
    ]);
  });

  it("is what `vp run db#check:migrations` exits non-zero on", async () => {
    const dir = await drizzleFolder({
      "20260101000000_one": "CREATE TABLE `a` (`id` text PRIMARY KEY NOT NULL);",
    });
    const empty = await mkdtemp(join(tmpdir(), "deevy-migrations-"));
    const script = new URL("../scripts/check-migrations.ts", import.meta.url).pathname;

    const failed = await run(process.execPath, [
      script,
      dir,
      empty,
      await currentDurableFile(dir),
    ]).catch((error: { code: number; stderr: string }) => error);

    expect(failed).toMatchObject({
      code: 1,
      stderr: expect.stringContaining("0001_20260101000000_one.sql is missing"),
    });
  });
});
