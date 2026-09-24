-- Generated from drizzle/20260921085855_absent_mattie_franklin/migration.sql by `vp run db#generate:d1`.
-- Edit packages/db/src/schema instead; wrangler applies this file to D1 (ADR-0008).

CREATE TABLE `inbound_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`socket_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`event_name` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_inbound_delivery_socket_id_socket_id_fk` FOREIGN KEY (`socket_id`) REFERENCES `socket`(`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX `inbound_delivery_uidx` ON `inbound_delivery` (`socket_id`,`delivery_id`);

CREATE INDEX `inbound_delivery_createdAt_idx` ON `inbound_delivery` (`created_at`);
