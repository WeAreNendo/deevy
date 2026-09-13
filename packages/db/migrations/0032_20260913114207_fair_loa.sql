-- Generated from drizzle/20260913114207_fair_loa/migration.sql by `vp run db#generate:d1`.
-- Edit packages/db/src/schema instead; wrangler applies this file to D1 (ADR-0008).

ALTER TABLE `room_state` ADD `compacted_at` integer;
