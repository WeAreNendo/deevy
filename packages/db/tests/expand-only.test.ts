/**
 * A migration only adds, so the release before it runs on its schema during a
 * gradual deploy and after a rollback (ADR-0031). The fixtures are SQL the way
 * drizzle-kit 1.0.0-rc.4 writes it for SQLite, statement breakpoints and all.
 */
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vite-plus/test";
import { checkMigrations } from "../scripts/check-migrations.ts";
import { projectMigrations } from "../scripts/emit-d1-migrations.ts";
import { checkExpandOnly, grandfathered } from "../scripts/expand-only.ts";

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

/** The migration every case builds on: a table with rows a release reads and writes. */
const before = {
  "20261010000000_issue":
    "CREATE TABLE `issue` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`title` text NOT NULL,\n\t`body` text\n);\n",
};

/** What the check says about `sql` as the migration after `before`. */
async function problemsWith(sql: string) {
  return checkExpandOnly(await drizzleFolder({ ...before, "20261011000000_next": sql }));
}

/** What drizzle-kit writes to make `issue.body` NOT NULL on SQLite, which has no ALTER COLUMN. */
const rebuild = [
  "PRAGMA foreign_keys=OFF;--> statement-breakpoint",
  "CREATE TABLE `__new_issue` (",
  "\t`id` text PRIMARY KEY NOT NULL,",
  "\t`title` text NOT NULL,",
  "\t`body` text NOT NULL",
  ");",
  "--> statement-breakpoint",
  "INSERT INTO `__new_issue`(`id`, `title`, `body`) SELECT `id`, `title`, `body` FROM `issue`;--> statement-breakpoint",
  "DROP TABLE `issue`;--> statement-breakpoint",
  "ALTER TABLE `__new_issue` RENAME TO `issue`;--> statement-breakpoint",
  "PRAGMA foreign_keys=ON;",
].join("\n");

describe("a migration that only adds", () => {
  it("passes: a table, a column, an index, a unique index on a new table, a dropped index", async () => {
    expect(
      await problemsWith(
        [
          "CREATE TABLE `label` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text NOT NULL\n);",
          "--> statement-breakpoint",
          "ALTER TABLE `issue` ADD `label_id` text REFERENCES label(id);--> statement-breakpoint",
          "ALTER TABLE `issue` ADD `priority` integer DEFAULT 0 NOT NULL;--> statement-breakpoint",
          "CREATE INDEX `issue_label_idx` ON `issue` (`label_id`);--> statement-breakpoint",
          "CREATE UNIQUE INDEX `label_name_uidx` ON `label` (`name`);--> statement-breakpoint",
          "DROP INDEX `issue_label_idx`;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("is not judged by what its comments say", async () => {
    expect(
      await problemsWith("-- DROP TABLE `issue`;\n/* ALTER TABLE `issue` DROP COLUMN `title`; */"),
    ).toEqual([]);
  });
});

describe("a migration that takes something away", () => {
  it("is refused for dropping a table, naming the line and what to do instead", async () => {
    const [problem, ...rest] = await problemsWith(
      "CREATE TABLE `label` (`id` text PRIMARY KEY NOT NULL);\n--> statement-breakpoint\nDROP TABLE `issue`;",
    );

    expect(rest).toEqual([]);
    expect(problem).toMatch(/^drizzle\/20261011000000_next\/migration\.sql:3: drops table `issue`/);
    expect(problem).toContain("Stop using it in one release and leave it in the schema");
    expect(problem).toContain("-- deevy: contract <why>, expanded in <earlier migration folder>");
  });

  for (const [sql, what] of [
    ["ALTER TABLE `issue` DROP COLUMN `body`;", "drops column `body` of `issue`"],
    ["ALTER TABLE issue DROP body;", "drops column `body` of `issue`"],
    ["ALTER TABLE `issue` RENAME COLUMN `body` TO `text`;", "renames column `body` of `issue`"],
    ["ALTER TABLE `issue` RENAME `body` TO `text`;", "renames column `body` of `issue`"],
    ["ALTER TABLE `issue` RENAME TO `ticket`;", "renames table `issue` to `ticket`"],
    ["DROP TABLE IF EXISTS `issue`;", "drops table `issue`"],
    [
      "CREATE UNIQUE INDEX `issue_title_uidx` ON `issue` (`title`);",
      "adds unique index `issue_title_uidx` to `issue`",
    ],
  ]) {
    it(`is refused: ${sql}`, async () => {
      const problems = await problemsWith(sql!);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`migration.sql:1: ${what!}`);
    });
  }

  it("is refused once for drizzle-kit's table rebuild, as the rebuild it is", async () => {
    const problems = await problemsWith(rebuild);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/migration\.sql:2: rebuilds `issue`/);
    expect(problems[0]).toContain("Add a new column instead");
  });

  it("names every statement that takes something away, in file order", async () => {
    const problems = await problemsWith(
      "ALTER TABLE `issue` DROP COLUMN `body`;--> statement-breakpoint\nDROP TABLE `issue`;",
    );

    expect(problems.map((problem) => problem.split(",")[0])).toEqual([
      "drizzle/20261011000000_next/migration.sql:1: drops column `body` of `issue`",
      "drizzle/20261011000000_next/migration.sql:2: drops table `issue`",
    ]);
  });
});

describe("a contraction that says so", () => {
  const annotated = (line: string) => `${line}\nALTER TABLE \`issue\` DROP COLUMN \`body\`;`;

  it("passes when it names an earlier migration", async () => {
    expect(
      await problemsWith(
        annotated(
          "-- deevy: contract nothing has read body since 0.11, expanded in 20261010000000_issue",
        ),
      ),
    ).toEqual([]);
  });

  it("passes for a rebuild, with the annotation anywhere on a line of its own", async () => {
    expect(
      await problemsWith(
        `${rebuild}\n-- deevy: contract body was backfilled in 0.11, expanded in 20261010000000_issue`,
      ),
    ).toEqual([]);
  });

  it("is refused when the migration it names does not exist", async () => {
    expect(
      await problemsWith(annotated("-- deevy: contract unused, expanded in 20261001000000_gone")),
    ).toEqual([
      "drizzle/20261011000000_next/migration.sql:1: expanded in 20261001000000_gone, which is " +
        "not a migration in packages/db/drizzle; name the folder of the migration that shipped " +
        "with the release that stopped using what this one removes",
    ]);
  });

  it("is refused when the migration it names is not earlier", async () => {
    const problems = await problemsWith(
      annotated("-- deevy: contract unused, expanded in 20261011000000_next"),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("which is not earlier than this migration");
  });

  it("is refused when it does not say why, or what expanded", async () => {
    for (const line of [
      "-- deevy: contract",
      "-- deevy: contract unused",
      "-- deevy: contract expanded in 20261010000000_issue",
    ]) {
      const problems = await problemsWith(annotated(line));
      expect(problems, line).toHaveLength(1);
      expect(problems[0]).toContain("a contraction names its reason and the earlier migration");
    }
  });

  it("is refused, given what the previous release carried, when that does not include it", async () => {
    const dir = await drizzleFolder({
      ...before,
      "20261010120000_text": "ALTER TABLE `issue` ADD `text` text;",
      "20261011000000_next": annotated(
        "-- deevy: contract text replaced body, expanded in 20261010120000_text",
      ),
    });
    const shipped = (...migrations: string[]) => ({
      shipped: { release: "v0.11.0", migrations: new Set(migrations) },
    });

    expect(
      await checkExpandOnly(dir, shipped("20261010000000_issue", "20261010120000_text")),
    ).toEqual([]);
    const [problem] = await checkExpandOnly(dir, shipped("20261010000000_issue"));
    expect(problem).toContain("expanded in 20261010120000_text, which v0.11.0 does not carry");
  });
});

describe("migrations written before ADR-0031", () => {
  const drizzleDir = new URL("../drizzle", import.meta.url).pathname;

  it("are named one by one, and every name is a migration in packages/db/drizzle", async () => {
    const folders = new Set(await readdir(drizzleDir));
    expect([...grandfathered].filter((name) => !folders.has(name))).toEqual([]);
  });

  it("are not judged, whatever they hold", async () => {
    const [first] = [...grandfathered];
    const dir = await drizzleFolder({ [first!]: "DROP TABLE `issue`;" });
    expect(await checkExpandOnly(dir)).toEqual([]);
  });

  it("leave the repository's own migrations passing", async () => {
    expect(await checkExpandOnly(drizzleDir)).toEqual([]);
  });
});

describe("check:migrations", () => {
  it("says what to do about a rebuild, rather than only that D1 will not take its PRAGMA", async () => {
    const dir = await drizzleFolder({ ...before, "20261011000000_next": rebuild });
    const empty = await mkdtemp(join(tmpdir(), "deevy-migrations-"));

    const problems = await checkMigrations({ drizzleDir: dir, migrationsDir: empty });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("rebuilds `issue`");
  });

  it("exits non-zero on a migration that takes something away", async () => {
    const dir = await drizzleFolder({ ...before, "20261011000000_next": "DROP TABLE `issue`;" });
    const projected = await mkdtemp(join(tmpdir(), "deevy-migrations-"));
    for (const { name, sql } of await projectMigrations(dir)) {
      await writeFile(join(projected, name), sql);
    }
    const script = new URL("../scripts/check-migrations.ts", import.meta.url).pathname;

    const failed = await run(process.execPath, [script, dir, projected]).catch(
      (error: { code: number; stderr: string }) => error,
    );

    expect(failed).toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        "drizzle/20261011000000_next/migration.sql:1: drops table `issue`",
      ),
    });
  });
});
