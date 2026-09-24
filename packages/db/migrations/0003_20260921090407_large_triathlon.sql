-- Generated from drizzle/20260921090407_large_triathlon/migration.sql by `vp run db#generate:d1`.
-- Edit packages/db/src/schema instead; wrangler applies this file to D1 (ADR-0008).

ALTER TABLE `project` ADD `last_polled_at` integer;

CREATE INDEX `project_lastPolledAt_idx` ON `project` (`last_polled_at`);
