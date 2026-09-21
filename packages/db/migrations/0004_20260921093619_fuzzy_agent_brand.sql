-- Generated from drizzle/20260921093619_fuzzy_agent_brand/migration.sql by `vp run db#generate:d1`.
-- Edit packages/db/src/schema instead; wrangler applies this file to D1 (ADR-0008).

CREATE TABLE `checkpoint` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`approvals_required` integer DEFAULT 1 NOT NULL,
	`exclude_requester` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_checkpoint_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);

CREATE TABLE `checkpoint_approver` (
	`checkpoint_id` text NOT NULL,
	`member_id` text NOT NULL,
	CONSTRAINT `checkpoint_approver_pk` PRIMARY KEY(`checkpoint_id`, `member_id`),
	CONSTRAINT `fk_checkpoint_approver_checkpoint_id_checkpoint_id_fk` FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoint`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_checkpoint_approver_member_id_member_id_fk` FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON DELETE CASCADE
);

CREATE TABLE `gate_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`gate_request_id` text NOT NULL,
	`member_id` text NOT NULL,
	`decision` text NOT NULL,
	`note` text,
	`via` text DEFAULT 'web' NOT NULL,
	`socket_id` text,
	`external_ref` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_gate_decision_gate_request_id_gate_request_id_fk` FOREIGN KEY (`gate_request_id`) REFERENCES `gate_request`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_gate_decision_member_id_member_id_fk` FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_gate_decision_socket_id_socket_id_fk` FOREIGN KEY (`socket_id`) REFERENCES `socket`(`id`) ON DELETE SET NULL
);

CREATE TABLE `gate_request` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`project_id` text NOT NULL,
	`checkpoint` text NOT NULL,
	`checkpoint_id` text,
	`proposal` text NOT NULL,
	`links` text DEFAULT '[]' NOT NULL,
	`requested_by` text NOT NULL,
	`visit` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`asked_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`decided_at` integer,
	CONSTRAINT `fk_gate_request_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_gate_request_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_gate_request_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_gate_request_checkpoint_id_checkpoint_id_fk` FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoint`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_gate_request_requested_by_member_id_fk` FOREIGN KEY (`requested_by`) REFERENCES `member`(`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX `checkpoint_uidx` ON `checkpoint` (`project_id`,`name`);

CREATE UNIQUE INDEX `gate_decision_uidx` ON `gate_decision` (`gate_request_id`,`member_id`);

CREATE UNIQUE INDEX `gate_request_open_uidx` ON `gate_request` (`run_id`,`checkpoint`) WHERE "gate_request"."status" = 'open';

CREATE INDEX `gate_request_issue_idx` ON `gate_request` (`issue_id`);

CREATE INDEX `gate_request_status_idx` ON `gate_request` (`project_id`,`status`);
