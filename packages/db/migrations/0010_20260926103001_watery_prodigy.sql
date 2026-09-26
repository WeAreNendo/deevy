-- Generated from drizzle/20260926103001_watery_prodigy/migration.sql by `vp run db#generate:d1`.
-- Edit packages/db/src/schema instead; wrangler applies this file to D1 (ADR-0008).

ALTER TABLE `run` ADD `waiting_ms` integer DEFAULT 0 NOT NULL;

ALTER TABLE `run` ADD `waiting_since` integer;
