-- Generated from drizzle/20261009073317_loose_vulcan/migration.sql by `vp run db#generate:d1`.
-- Edit packages/db/src/schema instead; wrangler applies this file to D1 (ADR-0008).

ALTER TABLE `invitation` ADD `sealed_token` text;
