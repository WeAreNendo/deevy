-- Generated from drizzle/20260913073220_burly_screwball/migration.sql by `vp run db#generate:d1`.
-- Edit packages/db/src/schema instead; wrangler applies this file to D1 (ADR-0008).

CREATE TABLE `document_version_author` (
	`version_id` text NOT NULL,
	`member_id` text NOT NULL,
	CONSTRAINT `document_version_author_pk` PRIMARY KEY(`version_id`, `member_id`),
	CONSTRAINT `fk_document_version_author_version_id_document_version_id_fk` FOREIGN KEY (`version_id`) REFERENCES `document_version`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_document_version_author_member_id_member_id_fk` FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON DELETE CASCADE
);

CREATE TABLE `room_state` (
	`room` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`document_id` text,
	`state` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_room_state_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_room_state_document_id_document_id_fk` FOREIGN KEY (`document_id`) REFERENCES `document`(`id`) ON DELETE CASCADE
);

CREATE INDEX `document_version_author_memberId_idx` ON `document_version_author` (`member_id`);

CREATE INDEX `room_state_issueId_idx` ON `room_state` (`issue_id`);
