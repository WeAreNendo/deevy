import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vite-plus/test";
import { checkMigrations } from "../scripts/check-migrations.ts";
import {
  projectDurableMigrations,
  renderDurableMigrations,
} from "../scripts/emit-durable-migrations.ts";
import { migrations } from "../src/durable-migrations.ts";

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

const rebuild =
  "CREATE TABLE `__new_a` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`note` text DEFAULT 'it''s \"quoted\" \\\\ ${not} a template'\n);\n" +
  "--> statement-breakpoint\n" +
  "INSERT INTO `__new_a`(`id`) SELECT `id` FROM `a`;--> statement-breakpoint\n" +
  "DROP TABLE `a`;";

/**
 * A Durable Object cannot read packages/db/drizzle, so it imports the same
 * migrations as a module. drizzle's durable-sqlite migrator splits each on
 * `--> statement-breakpoint` and journals it under its key, exactly as the Node
 * migrator does with a folder, so the module keeps both untouched.
 */
describe("the Durable Object projection of the drizzle migrations", () => {
  it("is each folder's migration.sql, verbatim, under the folder's name, in order", async () => {
    const dir = await drizzleFolder({
      "20260102000000_two": rebuild,
      "20260101000000_one": "CREATE TABLE `a` (`id` text PRIMARY KEY NOT NULL);",
    });

    const projected = await projectDurableMigrations(dir);

    expect(Object.entries(projected)).toEqual([
      ["20260101000000_one", "CREATE TABLE `a` (`id` text PRIMARY KEY NOT NULL);"],
      ["20260102000000_two", rebuild],
    ]);
  });

  it("renders a module that exports exactly that record", async () => {
    const dir = await drizzleFolder({ "20260101000000_one": rebuild });
    const projected = await projectDurableMigrations(dir);
    const file = join(await mkdtemp(join(tmpdir(), "deevy-durable-")), "durable-migrations.ts");
    await writeFile(file, renderDurableMigrations(projected));

    const rendered = (await import(file)) as { migrations: Record<string, string> };

    expect(rendered.migrations).toEqual(projected);
  });

  it("refuses what a Durable Object will not honour, naming the file and the line", async () => {
    const dir = await drizzleFolder({
      "20260101000000_rebuild": `PRAGMA foreign_keys=OFF;--> statement-breakpoint\n${rebuild}`,
    });

    await expect(projectDurableMigrations(dir)).rejects.toThrow(
      /drizzle\/20260101000000_rebuild\/migration\.sql:1\b.*Durable Object/s,
    );
  });
});

/**
 * Committed, like openapi.json, because the object
 * imports it at build time: what is in the repository must be what the emitter
 * writes today, or a hosted Workspace applies SQL nobody generated.
 */
describe("packages/db/src/durable-migrations.ts", () => {
  const drizzleDir = new URL("../drizzle", import.meta.url).pathname;
  const file = new URL("../src/durable-migrations.ts", import.meta.url).pathname;

  it("holds byte-for-byte what the emitter writes for the drizzle folders", async () => {
    const projected = await projectDurableMigrations(drizzleDir);

    expect(await readFile(file, "utf8")).toBe(renderDurableMigrations(projected));
    expect(migrations).toEqual(projected);
  });
});

describe("check:migrations on the Durable Object projection", () => {
  it("fails when the module is missing", async () => {
    const dir = await drizzleFolder({
      "20260101000000_one": "CREATE TABLE `a` (`id` text PRIMARY KEY NOT NULL);",
    });
    const nowhere = join(await mkdtemp(join(tmpdir(), "deevy-durable-")), "durable-migrations.ts");

    expect(await checkMigrations({ drizzleDir: dir, durableMigrationsFile: nowhere })).toEqual([
      "packages/db/src/durable-migrations.ts is missing; run `vp run db#generate:durable`",
    ]);
  });

  it("fails when a new drizzle folder has not reached the module", async () => {
    const before = await drizzleFolder({
      "20260101000000_one": "CREATE TABLE `a` (`id` text PRIMARY KEY NOT NULL);",
    });
    const stale = join(await mkdtemp(join(tmpdir(), "deevy-durable-")), "durable-migrations.ts");
    await writeFile(stale, renderDurableMigrations(await projectDurableMigrations(before)));
    const after = await drizzleFolder({
      "20260101000000_one": "CREATE TABLE `a` (`id` text PRIMARY KEY NOT NULL);",
      "20260102000000_two": "CREATE TABLE `b` (`id` text PRIMARY KEY NOT NULL);",
    });

    expect(await checkMigrations({ drizzleDir: after, durableMigrationsFile: stale })).toEqual([
      "packages/db/src/durable-migrations.ts is stale; run `vp run db#generate:durable`",
    ]);
  });

  it("is what `vp run db#check:migrations` exits non-zero on", async () => {
    const dir = await drizzleFolder({
      "20260101000000_one": "CREATE TABLE `a` (`id` text PRIMARY KEY NOT NULL);",
    });
    const nowhere = join(await mkdtemp(join(tmpdir(), "deevy-durable-")), "durable-migrations.ts");
    const script = new URL("../scripts/check-migrations.ts", import.meta.url).pathname;

    const failed = await run(process.execPath, [script, dir, nowhere]).catch(
      (error: { code: number; stderr: string }) => error,
    );

    expect(failed).toMatchObject({
      code: 1,
      stderr: expect.stringContaining("durable-migrations.ts is missing"),
    });
  });
});

/**
 * Discovered by applying migrations to a local Durable Object (and a local D1,
 * when deevy still ran on one), not guessed: workerd runs every migration
 * inside a transaction, so `PRAGMA foreign_keys=OFF` — which drizzle-kit wraps
 * around every table rebuild, and which the Node migrator honours at the
 * connection — is accepted and silently ignored there. The `DROP TABLE` in
 * that window then cascades children away.
 */
describe("statements a Durable Object will not take", () => {
  it("refuses a PRAGMA, naming the file and the line", async () => {
    const dir = await drizzleFolder({
      "20260101000000_rebuild":
        "CREATE TABLE `__new_a` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n" +
        "--> statement-breakpoint\n" +
        "PRAGMA foreign_keys=OFF;",
    });

    await expect(projectDurableMigrations(dir)).rejects.toThrow(
      /drizzle\/20260101000000_rebuild\/migration\.sql:5\b.*PRAGMA/s,
    );
  });

  it("reads whole statements, not lines, so a trigger body is not transaction control", async () => {
    const dir = await drizzleFolder({
      "20260101000000_trigger":
        "CREATE TRIGGER `t` AFTER INSERT ON `a`\nBEGIN\n\tDELETE FROM `b`;\nEND;",
    });

    const projected = await projectDurableMigrations(dir);
    expect(projected["20260101000000_trigger"]).toContain("CREATE TRIGGER `t` AFTER INSERT ON `a`");
  });

  /**
   * The contraction a rebuild is (ADR-0031) is annotated on a line of its own,
   * and drizzle opens every rebuild with the PRAGMA: a comment on top of a
   * statement must not hide what the statement is.
   */
  it("reads past a comment above a statement, and names the statement's line", async () => {
    const dir = await drizzleFolder({
      "20261011000000_rebuild":
        "-- deevy: contract nothing reads it, expanded in 20261010000000_one\n" +
        "PRAGMA foreign_keys=OFF;--> statement-breakpoint\n" +
        "DROP TABLE `a`;",
    });

    await expect(projectDurableMigrations(dir)).rejects.toThrow(
      /drizzle\/20261011000000_rebuild\/migration\.sql:2\b.*PRAGMA/s,
    );
  });

  /**
   * The rest of what a local object answered with an error rather than a row:
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

      await expect(projectDurableMigrations(dir)).rejects.toThrow(
        /20260101000000_one\/migration\.sql:3\b/,
      );
    });
  }
});
