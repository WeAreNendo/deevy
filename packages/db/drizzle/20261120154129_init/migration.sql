CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `apikey` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text DEFAULT 'default' NOT NULL,
	`name` text,
	`start` text,
	`reference_id` text NOT NULL,
	`prefix` text,
	`key` text NOT NULL,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` integer,
	`enabled` integer DEFAULT true,
	`rate_limit_enabled` integer DEFAULT true,
	`rate_limit_time_window` integer DEFAULT 86400000,
	`rate_limit_max` integer DEFAULT 10,
	`request_count` integer DEFAULT 0,
	`remaining` integer,
	`last_request` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`permissions` text,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL UNIQUE,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	CONSTRAINT `fk_session_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`kind` text DEFAULT 'human'
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`handle` text,
	`role` text DEFAULT 'member' NOT NULL,
	`kind` text DEFAULT 'human' NOT NULL,
	`sponsor_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`suspended_at` integer,
	CONSTRAINT `fk_member_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_member_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`max_delegation_depth` integer DEFAULT 3 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event` (
	`seq` integer PRIMARY KEY AUTOINCREMENT,
	`workspace_id` text NOT NULL,
	`actor_member_id` text,
	`kind` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`project_id` text,
	`payload` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_event_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_actor_member_id_member_id_fk` FOREIGN KEY (`actor_member_id`) REFERENCES `member`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `allowlist_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_allowlist_rule_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_allowlist_rule_created_by_member_id_fk` FOREIGN KEY (`created_by`) REFERENCES `member`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_member_id` text,
	`revoked_at` integer,
	CONSTRAINT `fk_invitation_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_invitation_created_by_member_id_fk` FOREIGN KEY (`created_by`) REFERENCES `member`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_invitation_accepted_member_id_member_id_fk` FOREIGN KEY (`accepted_member_id`) REFERENCES `member`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `socket` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`capabilities` text NOT NULL,
	`name` text NOT NULL,
	`identity` text NOT NULL,
	`config` text NOT NULL,
	`credentials` text,
	`webhook_secret` text,
	`previous_webhook_secret` text,
	`webhook_secret_changed_at` integer,
	`installed_by` text,
	`status` text DEFAULT 'active' NOT NULL,
	`last_inbound_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_socket_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_socket_installed_by_member_id_fk` FOREIGN KEY (`installed_by`) REFERENCES `member`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`tracker_socket_id` text NOT NULL,
	`tracker_scope` text NOT NULL,
	`tracker_scope_key` text NOT NULL,
	`default_agent_member_id` text,
	`chat_socket_id` text,
	`chat_channel` text,
	`routing` text DEFAULT '{"labelPrefix":"agent:","mention":true}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`archived_at` integer,
	CONSTRAINT `fk_project_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_tracker_socket_id_socket_id_fk` FOREIGN KEY (`tracker_socket_id`) REFERENCES `socket`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_project_default_agent_member_id_member_id_fk` FOREIGN KEY (`default_agent_member_id`) REFERENCES `member`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_project_chat_socket_id_socket_id_fk` FOREIGN KEY (`chat_socket_id`) REFERENCES `socket`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `agent` (
	`member_id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_agent_member_id_member_id_fk` FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `project_grant` (
	`member_id` text NOT NULL,
	`project_id` text NOT NULL,
	`granted_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `project_grant_pk` PRIMARY KEY(`member_id`, `project_id`),
	CONSTRAINT `fk_project_grant_member_id_member_id_fk` FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_grant_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_grant_granted_by_member_id_fk` FOREIGN KEY (`granted_by`) REFERENCES `member`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`payload` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_activity_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `run` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`agent_member_id` text NOT NULL,
	`triggered_by_member_id` text,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`summary` text,
	`started_at` integer,
	`last_activity_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`finished_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`waiting_ms` integer DEFAULT 0 NOT NULL,
	`waiting_since` integer,
	CONSTRAINT `fk_run_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_run_agent_member_id_member_id_fk` FOREIGN KEY (`agent_member_id`) REFERENCES `member`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_run_triggered_by_member_id_member_id_fk` FOREIGN KEY (`triggered_by_member_id`) REFERENCES `member`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `checkpoint_approver` (
	`checkpoint_id` text NOT NULL,
	`member_id` text NOT NULL,
	CONSTRAINT `checkpoint_approver_pk` PRIMARY KEY(`checkpoint_id`, `member_id`),
	CONSTRAINT `fk_checkpoint_approver_checkpoint_id_checkpoint_id_fk` FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoint`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_checkpoint_approver_member_id_member_id_fk` FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `gate_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`gate_request_id` text NOT NULL,
	`member_id` text NOT NULL,
	`decision` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_gate_decision_gate_request_id_gate_request_id_fk` FOREIGN KEY (`gate_request_id`) REFERENCES `gate_request`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_gate_decision_member_id_member_id_fk` FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `socket_mirror` (
	`id` text PRIMARY KEY NOT NULL,
	`gate_request_id` text,
	`socket_id` text NOT NULL,
	`kind` text NOT NULL,
	`external_ref` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_socket_mirror_gate_request_id_gate_request_id_fk` FOREIGN KEY (`gate_request_id`) REFERENCES `gate_request`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_socket_mirror_socket_id_socket_id_fk` FOREIGN KEY (`socket_id`) REFERENCES `socket`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `issue` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`socket_id` text NOT NULL,
	`external_id` text NOT NULL,
	`external_key` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`state` text NOT NULL,
	`state_name` text NOT NULL,
	`assignees` text DEFAULT '[]' NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`assignee_member_id` text,
	`parent_external_id` text,
	`parent_id` text,
	`external_updated_at` integer NOT NULL,
	`last_synced_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`closed_at` integer,
	CONSTRAINT `fk_issue_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_issue_socket_id_socket_id_fk` FOREIGN KEY (`socket_id`) REFERENCES `socket`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_issue_assignee_member_id_member_id_fk` FOREIGN KEY (`assignee_member_id`) REFERENCES `member`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `issue_link` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`kind` text NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`ref` text,
	`run_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_issue_link_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_issue_link_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_issue_link_created_by_member_id_fk` FOREIGN KEY (`created_by`) REFERENCES `member`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_member_id` text NOT NULL,
	`kind` text NOT NULL,
	`event_id` integer NOT NULL,
	`issue_id` text,
	`read_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_notification_recipient_member_id_member_id_fk` FOREIGN KEY (`recipient_member_id`) REFERENCES `member`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notification_event_id_event_seq_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`seq`) ON DELETE CASCADE,
	CONSTRAINT `fk_notification_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`target` text NOT NULL,
	`target_id` text NOT NULL,
	`event_seq` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`locked_until` integer,
	`last_status` integer,
	`last_error` text,
	`delivered_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_delivery_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_delivery_event_seq_event_seq_fk` FOREIGN KEY (`event_seq`) REFERENCES `event`(`seq`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `webhook_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`member_id` text,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`kinds` text,
	`project_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`disabled_at` integer,
	CONSTRAINT `fk_webhook_subscription_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_webhook_subscription_member_id_member_id_fk` FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_webhook_subscription_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_webhook_subscription_created_by_member_id_fk` FOREIGN KEY (`created_by`) REFERENCES `member`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE INDEX `apikey_configId_idx` ON `apikey` (`config_id`);--> statement-breakpoint
CREATE INDEX `apikey_referenceId_idx` ON `apikey` (`reference_id`);--> statement-breakpoint
CREATE INDEX `apikey_key_idx` ON `apikey` (`key`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE UNIQUE INDEX `member_userId_uidx` ON `member` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `member_handle_uidx` ON `member` (`handle`);--> statement-breakpoint
CREATE INDEX `member_workspaceId_idx` ON `member` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `member_sponsorId_idx` ON `member` (`sponsor_id`);--> statement-breakpoint
CREATE INDEX `event_workspaceId_seq_idx` ON `event` (`workspace_id`,`seq`);--> statement-breakpoint
CREATE INDEX `event_subject_idx` ON `event` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `event_projectId_seq_idx` ON `event` (`project_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `allowlist_rule_uidx` ON `allowlist_rule` (`workspace_id`,`kind`,`value`);--> statement-breakpoint
CREATE INDEX `allowlist_rule_workspaceId_idx` ON `allowlist_rule` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_live_uidx` ON `invitation` (`workspace_id`,`email`) WHERE accepted_at is null and revoked_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_tokenHash_uidx` ON `invitation` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitation_workspaceId_idx` ON `invitation` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_delivery_uidx` ON `inbound_delivery` (`socket_id`,`delivery_id`);--> statement-breakpoint
CREATE INDEX `inbound_delivery_createdAt_idx` ON `inbound_delivery` (`created_at`);--> statement-breakpoint
CREATE INDEX `socket_workspaceId_status_idx` ON `socket` (`workspace_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_slug_uidx` ON `project` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_tracker_uidx` ON `project` (`tracker_socket_id`,`tracker_scope_key`);--> statement-breakpoint
CREATE INDEX `project_workspaceId_idx` ON `project` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `project_grant_projectId_idx` ON `project_grant` (`project_id`);--> statement-breakpoint
CREATE INDEX `activity_runId_idx` ON `activity` (`run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `run_issueId_idx` ON `run` (`issue_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `run_createdAt_idx` ON `run` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `run_agent_status_idx` ON `run` (`agent_member_id`,`status`);--> statement-breakpoint
CREATE INDEX `run_status_lastActivityAt_idx` ON `run` (`status`,`last_activity_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `run_open_per_issue_agent_uidx` ON `run` (`issue_id`,`agent_member_id`) WHERE "run"."status" in ('pending', 'active', 'awaiting_input', 'stale');--> statement-breakpoint
CREATE UNIQUE INDEX `checkpoint_uidx` ON `checkpoint` (`project_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `gate_decision_uidx` ON `gate_decision` (`gate_request_id`,`member_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gate_request_open_uidx` ON `gate_request` (`run_id`,`checkpoint`) WHERE "gate_request"."status" = 'open';--> statement-breakpoint
CREATE INDEX `gate_request_issue_idx` ON `gate_request` (`issue_id`);--> statement-breakpoint
CREATE INDEX `gate_request_status_idx` ON `gate_request` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `socket_mirror_gate_idx` ON `socket_mirror` (`gate_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_external_uidx` ON `issue` (`socket_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `issue_externalKey_idx` ON `issue` (`external_key`);--> statement-breakpoint
CREATE INDEX `issue_url_idx` ON `issue` (`url`);--> statement-breakpoint
CREATE INDEX `issue_projectId_state_idx` ON `issue` (`project_id`,`state`);--> statement-breakpoint
CREATE INDEX `issue_assignee_idx` ON `issue` (`assignee_member_id`);--> statement-breakpoint
CREATE INDEX `issue_parentId_idx` ON `issue` (`parent_id`);--> statement-breakpoint
CREATE INDEX `issue_externalUpdatedAt_idx` ON `issue` (`external_updated_at`);--> statement-breakpoint
CREATE INDEX `issue_link_issueId_idx` ON `issue_link` (`issue_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notification_recipient_idx` ON `notification` (`recipient_member_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notification_eventId_idx` ON `notification` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_event_uidx` ON `notification` (`recipient_member_id`,`kind`,`event_id`);--> statement-breakpoint
CREATE INDEX `delivery_due_idx` ON `delivery` (`delivered_at`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `delivery_target_idx` ON `delivery` (`target_id`,`event_seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_event_uidx` ON `delivery` (`target`,`target_id`,`event_seq`);--> statement-breakpoint
CREATE INDEX `webhook_subscription_workspace_idx` ON `webhook_subscription` (`workspace_id`,`disabled_at`);--> statement-breakpoint
CREATE INDEX `webhook_subscription_memberId_idx` ON `webhook_subscription` (`member_id`);