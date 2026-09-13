-- Generated from drizzle/20260913163519_silent_marrow/migration.sql by `vp run db#generate:d1`.
-- Edit packages/db/src/schema instead; wrangler applies this file to D1 (ADR-0008).

ALTER TABLE `workspace` ADD `max_children_per_issue` integer DEFAULT 20 NOT NULL;

ALTER TABLE `workspace` ADD `max_delegation_depth` integer DEFAULT 3 NOT NULL;

ALTER TABLE `workspace` ADD `max_open_descendants` integer DEFAULT 50 NOT NULL;
