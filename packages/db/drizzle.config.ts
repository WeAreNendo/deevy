import { defineConfig } from "drizzle-kit";

// Migrations are generated here and applied by the runtime migrator on Node
// (packages/adapters/src/node) or, from packages/db/src/durable-migrations.ts,
// by a hosted Workspace's Durable Object (packages/adapters/src/durable).
// Never by `drizzle-kit migrate` (ADR-0008).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
});
