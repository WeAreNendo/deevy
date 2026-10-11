import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createDurableDb,
  dumpDatabase,
  migrateDurable,
  type DurableStorage,
} from "@deevy/adapters/durable";
import { openDatabase } from "@deevy/adapters/node";
import { createNodeDurableStorage } from "@deevy/adapters/testing";
import { socket, type Db } from "@deevy/db";
import { migrations } from "@deevy/db/durable-migrations";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";
import { appendEvent } from "../src/events.ts";
import { openSecret, sealSecret } from "../src/secrets.ts";
import {
  agentContext,
  memberContext,
  migrationsFolder,
  seedProject,
  testSealingSecret,
} from "./helpers.ts";

/** What a Workspace holds after a little use, written the way the core writes it. */
async function aWorkspace(db: Db) {
  const admin = await memberContext(db, { name: "Ada", role: "admin" });
  // An Agent names its Sponsor, another row of the same table: a foreign key
  // the dump has to restore whatever order the rows come out in.
  const planner = await agentContext(db, { name: "Planner", sponsor: admin.member });
  const seeded = await seedProject(db, admin.workspace.id, { webhookSecret: "whsec_dumped" });
  await db
    .update(socket)
    .set({ credentials: await sealSecret(testSealingSecret, '{"token":"tok_dumped"}') })
    .where(eq(socket.id, seeded.socketId));
  const issue = await seeded.record({ externalId: "42", title: "Retry webhooks" });
  await appendEvent(
    { db, workspace: admin.workspace, member: planner.member },
    {
      kind: "issue.synced",
      subjectType: "issue",
      subjectId: issue.id,
      projectId: seeded.project.id,
      payload: { note: 'it\'s "quoted"\nand on two lines' },
    },
  );
  return { socketId: seeded.socketId };
}

/** Every row of every table deevy keeps, read the way a Durable Object reads them. */
function everything(storage: DurableStorage): Record<string, unknown[]> {
  const tables = storage.sql
    .exec<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name`,
    )
    .toArray()
    .map(({ name }) => name);
  return Object.fromEntries(
    [...tables, "sqlite_sequence"].map((table) => [
      table,
      storage.sql.exec(`SELECT * FROM "${table}" ORDER BY rowid`).toArray(),
    ]),
  );
}

/**
 * A hosted Workspace goes home as a dump of its Durable Object's database,
 * opened by the Docker image (ADR-0028). This is that trip: written through the
 * core on the durable driver, dumped, loaded into a plain SQLite file, and
 * opened by `openDatabase` with nothing left to apply and every row as it was.
 */
describe("a durable database's dump", () => {
  it("opens under openDatabase with nothing pending and every row, sealed ones included", async () => {
    const source = createNodeDurableStorage();
    const durable = createDurableDb(source);
    expect(migrateDurable(durable, migrations).error).toBeNull();
    const { socketId } = await aWorkspace(durable);
    const before = everything(source);
    for (const table of ["workspace", "user", "member", "agent", "socket", "issue", "event"]) {
      expect(before[table], table).not.toHaveLength(0);
    }

    const path = join(await mkdtemp(join(tmpdir(), "deevy-dump-")), "deevy.sqlite");
    const file = new DatabaseSync(path);
    file.exec([...dumpDatabase(source)].join(""));
    file.close();

    const ran: string[] = [];
    const opened = openDatabase({
      path,
      migrationsFolder,
      logger: { logQuery: (query) => ran.push(query) },
    });
    expect(ran.filter((query) => /insert into "__drizzle_migrations"/i.test(query))).toEqual([]);
    // The core reads it on the Node driver as it read it on the durable one,
    // and the secrets it sealed in the object still open.
    expect(await opened.db.query.member.findMany({ orderBy: { id: "asc" } })).toEqual(
      await durable.query.member.findMany({ orderBy: { id: "asc" } }),
    );
    const restored = await opened.db.query.socket.findFirst({ where: { id: socketId } });
    expect(await openSecret(testSealingSecret, restored?.webhookSecret ?? "")).toBe("whsec_dumped");
    expect(await openSecret(testSealingSecret, restored?.credentials ?? "")).toBe(
      '{"token":"tok_dumped"}',
    );
    opened.close();

    const reopened = createNodeDurableStorage(path);
    expect(everything(reopened)).toEqual(before);
    reopened.close();
    source.close();
  });
});
