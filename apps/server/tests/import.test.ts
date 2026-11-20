/**
 * A hosted Workspace taken home (docs/OPERATIONS.md, "Taking a hosted
 * Workspace home"): dumped from its Durable Object, imported by the image's
 * `dist/import.mjs`, and served by the image's own server with the two secrets
 * the export handed over.
 *
 * The OAuth stub replaces `fetch` for the process, so it is installed here and
 * put back afterwards, as tests/stub-oauth.test.ts does.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "@deevy/adapters/node";
import { openSecret } from "@deevy/core";
import { migrations as everyMigration } from "@deevy/db/durable-migrations";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { readEnv } from "../src/env.ts";
import { ImportRefused, importDump, migrationNames } from "../src/import-dump.ts";
import { buildServer } from "../src/server.ts";
import {
  callerFor,
  hostedSecrets,
  hostedWorkspace,
  signIn,
  workspaceAt,
} from "./hosted-workspace.ts";

const realFetch = globalThis.fetch;
await import("../../web/scripts/stub-oauth.js");
afterAll(() => {
  globalThis.fetch = realFetch;
});

const migrationsFolder = new URL("../../../packages/db/drizzle", import.meta.url).pathname;
/** Where the team's own deevy answers. */
const homeURL = "https://deevy.example.org";
const known = migrationNames(migrationsFolder);

async function aVolume(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "deevy-import-")), "deevy.sqlite");
}

/** A dump whose journal names a migration this release does not have. */
function fromTheFuture(dump: string): string {
  return dump.replace(
    "COMMIT;\n",
    `INSERT INTO "__drizzle_migrations" ("hash", "created_at", "name") VALUES('', 0, '29991231000000_not_yet');\nCOMMIT;\n`,
  );
}

describe("a hosted Workspace's dump, imported into the image", () => {
  it("serves its Members, opens its Sockets and carries on its Event log, at the new address", async () => {
    const hosted = await hostedWorkspace();
    const path = await aVolume();
    const report = await importDump({
      dump: hosted.dump(),
      path,
      migrationsFolder,
      baseURL: homeURL,
      socketSecret: hostedSecrets.deevySecret,
    });
    expect(report).toMatchObject({
      workspace: { name: "Acme" },
      humans: 2,
      agents: 1,
      admins: ["ada@example.com"],
      sockets: [{ id: hosted.socketId, name: "Acme tracker", provider: "stub" }],
      projects: 1,
      nextSeq: hosted.eventSeq + 1,
      migrations: [],
      // The Socket's credential and its webhook secret, both sealed in the object.
      sealed: { checked: 2, failed: [] },
    });
    hosted.storage.close();

    // The image's server on the imported file, with the two secrets the
    // export handed over, at the team's own address.
    const server = buildServer({
      ...readEnv({}),
      databasePath: path,
      migrationsFolder,
      baseURL: homeURL,
      secret: hostedSecrets.betterAuthSecret,
      socketSecret: hostedSecrets.deevySecret,
      providers: { github: { clientId: "stub-client", clientSecret: "stub-secret" } },
      devStubSockets: true,
    });
    await server.auth.$context;
    const as = (headers: HeadersInit) =>
      callerFor(
        {
          db: server.db,
          auth: server.auth,
          baseURL: homeURL,
          socketSecret: hostedSecrets.deevySecret,
        },
        headers,
      );

    // Signing in again, through a provider of the team's own, lands on the
    // Member the Workspace already had, as its admin.
    const ada = await as({ cookie: await signIn(server.app, homeURL, "ada@example.com") });
    expect(ada.member).toMatchObject({ id: hosted.members.ada, role: "admin" });
    expect((await ada.api.members.list({})).members.map(({ id }) => id).sort()).toEqual(
      Object.values(hosted.members).sort(),
    );

    // The Socket's credentials open under the same DEEVY_SECRET: the module is
    // built with them and asked who deevy is at the tool.
    expect(await ada.api.sockets.test({ socketId: hosted.socketId })).toMatchObject({ ok: true });
    const socket = await server.db.query.socket.findFirst({ where: { id: hosted.socketId } });
    expect(await openSecret(hostedSecrets.deevySecret, socket?.credentials ?? "")).toBe(
      '{"token":"tok_hosted"}',
    );
    expect(await openSecret(hostedSecrets.deevySecret, socket?.webhookSecret ?? "")).toBe(
      "whsec_hosted",
    );

    // An Agent's key is no address's, so only its DEEVY_URL changes.
    const planner = await as({ authorization: `Bearer ${hosted.agentKey}` });
    expect(planner.member.id).toBe(hosted.members.planner);

    // The next Event follows the counter, not the highest row.
    await ada.api.allowlist.add({ kind: "email_domain", value: "example.org" });
    const newest = await server.db.query.event.findFirst({ orderBy: { seq: "desc" } });
    expect(newest?.seq).toBe(hosted.eventSeq + 1);

    server.close();

    // Nothing was pending when the server opened it, and nothing is now.
    const ran: string[] = [];
    openDatabase({
      path,
      migrationsFolder,
      logger: { logQuery: (query) => ran.push(query) },
    }).close();
    expect(ran.filter((query) => /insert into "__drizzle_migrations"/i.test(query))).toEqual([]);
  });

  it("says when DEEVY_SECRET is not the one the Workspace sealed with", async () => {
    const hosted = await hostedWorkspace();
    const report = await importDump({
      dump: hosted.dump(),
      path: await aVolume(),
      migrationsFolder,
      socketSecret: "some-other-secret-of-at-least-32-characters",
    });
    hosted.storage.close();
    expect(report.sealed).toEqual({
      checked: 2,
      failed: ["the Acme tracker Socket's credentials", "the Acme tracker Socket's webhook secret"],
    });
  });

  it("brings a dump from an older release forward with the image's own migrator", async () => {
    // A release on from this one: its migrations and one more, which the
    // Workspace dumped here has not applied.
    const later = join(await mkdtemp(join(tmpdir(), "deevy-later-")), "drizzle");
    await cp(migrationsFolder, later, { recursive: true });
    await mkdir(join(later, "29991231000000_later"));
    await writeFile(
      join(later, "29991231000000_later", "migration.sql"),
      "ALTER TABLE `workspace` ADD `motto` text;",
    );
    const path = await aVolume();
    const report = await importDump({
      dump: workspaceAt(everyMigration),
      path,
      migrationsFolder: later,
    });
    expect(report.migrations).toEqual(["29991231000000_later"]);

    const db = new DatabaseSync(path);
    const names = db.prepare(`SELECT name FROM "__drizzle_migrations"`).all() as Array<{
      name: string;
    }>;
    db.close();
    expect(names.map(({ name }) => name)).toEqual([...known, "29991231000000_later"]);
  });

  /**
   * deevy's migration history started afresh in 0.12 (ADR-0031's one
   * exception), so a Workspace dumped by a release before it shares no
   * migration with this one, and is not one a newer deevy wrote either.
   */
  it("refuses a dump from before deevy's migration history started afresh", async () => {
    const path = await aVolume();
    // The tables every Workspace's dump holds, as a release before it made them.
    const before = workspaceAt({
      "20261102093420_marvelous_mojo": [
        "CREATE TABLE `workspace` (`id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `slug` text NOT NULL);",
        ...["member", "user", "socket", "project"].map(
          (table) => `CREATE TABLE \`${table}\` (\`id\` text PRIMARY KEY NOT NULL);`,
        ),
        "CREATE TABLE `event` (`seq` integer PRIMARY KEY AUTOINCREMENT);",
      ].join("\n--> statement-breakpoint\n"),
    });

    await expect(importDump({ dump: before, path, migrationsFolder })).rejects.toThrow(
      /This dump was written by a deevy from before 0\.12.*20261102093420_marvelous_mojo/s,
    );
    expect(existsSync(path)).toBe(false);
  });

  it("refuses a dump from a newer release, which this image would not know the schema of", async () => {
    const path = await aVolume();
    await expect(
      importDump({ dump: fromTheFuture(workspaceAt(everyMigration)), path, migrationsFolder }),
    ).rejects.toThrow(/newer deevy than this one: it has applied 29991231000000_not_yet/);
    expect(existsSync(path)).toBe(false);
  });

  it("never imports over a database that holds a Workspace, or one a server already made", async () => {
    const dump = workspaceAt(everyMigration);
    const path = await aVolume();
    await importDump({ dump, path, migrationsFolder });
    const before = readFileSync(path);
    await expect(importDump({ dump, path, migrationsFolder })).rejects.toThrow(
      /already holds the Workspace "Acme"/,
    );
    expect(readFileSync(path).equals(before)).toBe(true);

    // A server started on the volume first: migrated, and nobody signed in.
    const started = await aVolume();
    openDatabase({ path: started, migrationsFolder }).close();
    await expect(importDump({ dump, path: started, migrationsFolder })).rejects.toThrow(
      /holds an empty deevy database/,
    );
  });

  it("leaves nothing behind when the file is not a whole Workspace's dump", async () => {
    const dump = workspaceAt(everyMigration);
    const cases: Array<[string, RegExp]> = [
      ["CREATE TABLE notes (body text);\n", /not a deevy Workspace's dump/],
      ['PRAGMA foreign_keys=OFF;\nCREATE TABLE "notes" (body text);\n', /stops before its end/],
      // Cut between two statements, which loads without a word.
      [dump.slice(0, dump.indexOf("COMMIT;")), /stops before its end/],
      // Cut inside one.
      [dump.slice(0, dump.indexOf("INSERT INTO") + 20), /did not load/],
      [
        workspaceAt(everyMigration).replace(
          "COMMIT;\n",
          `INSERT INTO "workspace" ("id", "name", "slug") VALUES('ws_b', 'B', 'b');\nCOMMIT;\n`,
        ),
        /holds 2 Workspaces/,
      ],
      [
        dump.replace(
          "COMMIT;\n",
          `INSERT INTO "member" ("id", "workspace_id", "user_id") VALUES('mem_x', 'ws_acme', 'usr_nobody');\nCOMMIT;\n`,
        ),
        /name a row it does not hold/,
      ],
    ];
    for (const [file, refusal] of cases) {
      const path = await aVolume();
      const failure = await importDump({ dump: file, path, migrationsFolder }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure, String(refusal)).toBeInstanceOf(ImportRefused);
      expect((failure as Error).message).toMatch(refusal);
      // Not the database, and not the scratch file it was being built in.
      expect(readdirSync(join(path, ".."))).toEqual([]);
    }
  });
});

describe("a hosted Workspace's dump, anywhere but the image", () => {
  // deevy is deployed as the image or as a hosted Workspace (ADR-0037), so a
  // Workspace taken home goes into the image's database, and into no D1.
  it("is written for nothing else", async () => {
    const converters = Object.keys(await import("../src/import-dump.ts"));
    expect(converters.filter((name) => /d1/i.test(name))).toEqual([]);
  });
});
