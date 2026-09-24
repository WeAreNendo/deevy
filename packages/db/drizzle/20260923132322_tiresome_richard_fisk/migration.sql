CREATE TABLE `link_code` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`socket_id` text NOT NULL,
	`provider` text NOT NULL,
	`instance` text NOT NULL,
	`external_user_id` text NOT NULL,
	`external_login` text,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`redeemed_at` integer,
	`redeemed_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_link_code_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_link_code_redeemed_by_member_id_fk` FOREIGN KEY (`redeemed_by`) REFERENCES `member`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `socket` ADD `previous_webhook_secret` text;--> statement-breakpoint
ALTER TABLE `socket` ADD `webhook_secret_changed_at` integer;--> statement-breakpoint
ALTER TABLE `notification_preference` ADD `slack_dm` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `link_code_hash_uidx` ON `link_code` (`code_hash`);