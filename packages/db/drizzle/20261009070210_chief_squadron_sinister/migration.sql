CREATE TABLE `email_sender` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`sender` text NOT NULL,
	`from` text NOT NULL,
	`config` text NOT NULL,
	`credentials` text NOT NULL,
	`updated_by` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_email_sender_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_email_sender_updated_by_member_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `member`(`id`) ON DELETE SET NULL
);
