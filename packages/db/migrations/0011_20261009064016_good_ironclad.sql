-- Generated from drizzle/20261009064016_good_ironclad/migration.sql by `vp run db#generate:d1`.
-- Edit packages/db/src/schema instead; wrangler applies this file to D1 (ADR-0008).

ALTER TABLE `notification_preference` ADD `email` integer;
