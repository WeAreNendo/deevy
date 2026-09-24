-- Generated from drizzle/20260923124622_wild_iron_fist/migration.sql by `vp run db#generate:d1`.
-- Edit packages/db/src/schema instead; wrangler applies this file to D1 (ADR-0008).

CREATE TABLE `member_identity` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`member_id` text NOT NULL,
	`provider` text NOT NULL,
	`instance` text NOT NULL,
	`external_user_id` text NOT NULL,
	`external_login` text,
	`verified_by` text NOT NULL,
	`linked_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`revoked_at` integer,
	CONSTRAINT `fk_member_identity_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_member_identity_member_id_member_id_fk` FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX `member_identity_live_idx` ON `member_identity` (`provider`,`instance`,`external_user_id`) WHERE "member_identity"."revoked_at" is null;

CREATE INDEX `member_identity_memberId_idx` ON `member_identity` (`member_id`);
