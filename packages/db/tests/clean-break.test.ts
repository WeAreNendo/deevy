import { readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { describe, expect, it } from "vite-plus/test";
import { cleanBreak } from "../scripts/expand-only.ts";
import { migrations } from "../src/durable-migrations.ts";
import { relations } from "../src/index.ts";
import { tables } from "../src/relations.ts";

const drizzleDir = new URL("../drizzle", import.meta.url).pathname;

async function folders(): Promise<string[]> {
  return (await readdir(drizzleDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** A database the Node migrator built from packages/db/drizzle, as a fresh image's is. */
function fresh(): DatabaseSync {
  const client = new DatabaseSync(":memory:");
  const failure = migrate(drizzle({ client, relations }), { migrationsFolder: drizzleDir });
  if (failure) throw new Error(JSON.stringify(failure));
  return client;
}

function tablesIn(client: DatabaseSync): string[] {
  return (
    client
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map(({ name }) => name);
}

function columnsOf(client: DatabaseSync, table: string): string[] {
  return (
    client.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as Array<{ name: string }>
  ).map(({ name }) => name);
}

/**
 * The release that carries docs/plans/simplify.md starts its migration history
 * afresh (slice 12), the one exception ADR-0031 makes. Every slice before it
 * stopped reading what it cut and left it in the schema, because a dropped
 * table or column is what that ADR's guard refuses; this is where they go.
 */
describe("the clean break", () => {
  it("begins the migration history at one init, the same for Node and a Durable Object", async () => {
    const history = await folders();

    expect(history[0]).toBe(cleanBreak);
    expect(cleanBreak).toMatch(/^\d{14}_init$/);
    expect(Object.keys(migrations)).toEqual(history);
  });

  it("creates the tables deevy reads, and no other", () => {
    const client = fresh();

    expect(tablesIn(client)).toEqual(Object.values(tables).map(getTableName).sort());
    client.close();
  });

  it("creates none of the tables the simplification stopped reading", () => {
    const client = fresh();
    const cut = [
      // slice 3: deevy takes no usage reports.
      "run_usage",
      // slice 8: no Channels, routing, preferences or email.
      "channel",
      "routing_rule",
      "notification_preference",
      "email_sender",
      // slice 9: deevy is no OAuth authorization server.
      "jwks",
      "oauth_client",
      "oauth_resource",
      "oauth_client_resource",
      "oauth_refresh_token",
      "oauth_access_token",
      "oauth_consent",
      "oauth_client_assertion",
      // slice 10: a Ruling is made in deevy, so there is no Identity to link.
      "member_identity",
      "link_code",
    ];

    expect(tablesIn(client).filter((table) => cut.includes(table))).toEqual([]);
    client.close();
  });

  it("creates none of the columns the simplification stopped reading", () => {
    const client = fresh();
    const cut: Record<string, string[]> = {
      // slices 2 and 4: no forge, no documents, nothing mirrored but Gates, no polling.
      project: [
        "forge_socket_id",
        "forge_scope",
        "docs_socket_id",
        "docs_scope",
        "mirror",
        "last_polled_at",
      ],
      socket: ["poll_minutes"],
      // slice 4: deevy opens no record.
      issue: ["created_by"],
      // slice 6: no schedules, and one ceiling on a tree of sub-issues.
      agent: ["schedule_minutes", "schedule_ran_at"],
      workspace: ["max_children_per_issue", "max_open_descendants"],
      // slice 8: nothing deevy sends is email, and nothing goes to one Human.
      invitation: ["sealed_token"],
      delivery: ["recipient_member_id"],
      // slice 10: every Ruling is made in deevy.
      gate_decision: ["via", "socket_id", "external_ref"],
    };

    const left = Object.entries(cut).flatMap(([table, columns]) =>
      columnsOf(client, table)
        .filter((column) => columns.includes(column))
        .map((column) => `${table}.${column}`),
    );

    expect(left).toEqual([]);
    client.close();
  });
});
