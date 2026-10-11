import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { checkMigrations } from "../scripts/check-migrations.ts";
import {
  projectDurableMigrations,
  projectMigrations,
  renderDurableMigrations,
} from "../scripts/emit-d1-migrations.ts";
import { migrations } from "../src/durable-migrations.ts";

/** A throwaway drizzle output folder holding the given migrations. */
async function drizzleFolder(migrations: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "deevy-drizzle-"));
  for (const [name, sql] of Object.entries(migrations)) {
    await mkdir(join(dir, name), { recursive: true });
    await writeFile(join(dir, name, "migration.sql"), sql);
  }
  return dir;
}

/** A D1 projection folder that is current for `drizzleDir`, so only the module is in question. */
async function currentD1Folder(drizzleDir: string) {
  const dir = await mkdtemp(join(tmpdir(), "deevy-migrations-"));
  for (const { name, sql } of await projectMigrations(drizzleDir)) {
    await writeFile(join(dir, name), sql);
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
 * Committed, like openapi.json and packages/db/migrations, because the object
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

    expect(
      await checkMigrations({
        drizzleDir: dir,
        migrationsDir: await currentD1Folder(dir),
        durableMigrationsFile: nowhere,
      }),
    ).toEqual(["packages/db/src/durable-migrations.ts is missing; run `vp run db#generate:d1`"]);
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

    expect(
      await checkMigrations({
        drizzleDir: after,
        migrationsDir: await currentD1Folder(after),
        durableMigrationsFile: stale,
      }),
    ).toEqual(["packages/db/src/durable-migrations.ts is stale; run `vp run db#generate:d1`"]);
  });
});
