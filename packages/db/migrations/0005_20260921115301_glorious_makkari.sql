-- Generated from drizzle/20260921115301_glorious_makkari/migration.sql by `vp run db#generate:d1`.
-- Edit packages/db/src/schema instead; wrangler applies this file to D1 (ADR-0008).

CREATE INDEX `run_createdAt_idx` ON `run` (`created_at`,`id`);
