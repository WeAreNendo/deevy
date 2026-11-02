-- Generated from drizzle/20261102093420_marvelous_mojo/migration.sql by `vp run db#generate:d1`.
-- Edit packages/db/src/schema instead; wrangler applies this file to D1 (ADR-0008).

ALTER TABLE `project` ADD `chat_socket_id` text REFERENCES socket(id) ON DELETE SET NULL;

ALTER TABLE `project` ADD `chat_channel` text;
