-- Generated from drizzle/20260921071441_init/migration.sql by `vp run db#generate:d1`.
-- Edit packages/db/src/schema instead; wrangler applies this file to D1 (ADR-0008).

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

CREATE TABLE `jwks` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`alg` text,
	`crv` text
);

CREATE TABLE `oauth_access_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text UNIQUE,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text,
	`reference_id` text,
	`authorization_code_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`refresh_id` text,
	`expires_at` integer,
	`created_at` integer,
	`revoked` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	CONSTRAINT `fk_oauth_access_token_client_id_oauth_client_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauth_access_token_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_oauth_access_token_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauth_access_token_refresh_id_oauth_refresh_token_id_fk` FOREIGN KEY (`refresh_id`) REFERENCES `oauth_refresh_token`(`id`) ON DELETE CASCADE
);

CREATE TABLE `oauth_client` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL UNIQUE,
	`client_secret` text,
	`client_discovery_id` text,
	`disabled` integer DEFAULT false,
	`skip_consent` integer,
	`enable_end_session` integer,
	`subject_type` text,
	`scopes` text,
	`client_credentials_scopes` text DEFAULT '[]',
	`user_id` text,
	`created_at` integer,
	`updated_at` integer,
	`name` text,
	`uri` text,
	`icon` text,
	`contacts` text,
	`tos` text,
	`policy` text,
	`software_id` text,
	`software_version` text,
	`software_statement` text,
	`redirect_uris` text NOT NULL,
	`post_logout_redirect_uris` text,
	`backchannel_logout_uri` text,
	`backchannel_logout_session_required` integer,
	`token_endpoint_auth_method` text,
	`application_type` text,
	`jwks` text,
	`jwks_uri` text,
	`grant_types` text,
	`response_types` text,
	`require_pkce` integer,
	`dpop_bound_access_tokens` integer DEFAULT false,
	`reference_id` text,
	`metadata` text,
	CONSTRAINT `fk_oauth_client_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE TABLE `oauth_client_assertion` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);

CREATE TABLE `oauth_client_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`metadata` text,
	`created_at` integer,
	CONSTRAINT `fk_oauth_client_resource_client_id_oauth_client_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauth_client_resource_resource_id_oauth_resource_identifier_fk` FOREIGN KEY (`resource_id`) REFERENCES `oauth_resource`(`identifier`) ON DELETE CASCADE
);

CREATE TABLE `oauth_consent` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text,
	`reference_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`scopes` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	CONSTRAINT `fk_oauth_consent_client_id_oauth_client_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauth_consent_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE TABLE `oauth_refresh_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL UNIQUE,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text NOT NULL,
	`reference_id` text,
	`authorization_code_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`expires_at` integer,
	`created_at` integer,
	`revoked` integer,
	`rotated_at` integer,
	`rotation_replay_response` text,
	`rotation_replay_expires_at` integer,
	`auth_time` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	CONSTRAINT `fk_oauth_refresh_token_client_id_oauth_client_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauth_refresh_token_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_oauth_refresh_token_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE TABLE `oauth_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`access_token_ttl` integer,
	`refresh_token_ttl` integer,
	`signing_algorithm` text,
	`signing_key_id` text,
	`allowed_scopes` text,
	`custom_claims` text,
	`dpop_bound_access_tokens_required` integer DEFAULT false,
	`disabled` integer DEFAULT false,
	`created_at` integer,
	`updated_at` integer,
	`policy_version` integer DEFAULT 1,
	`metadata` text
);

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

CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);

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

CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`max_children_per_issue` integer DEFAULT 20 NOT NULL,
	`max_delegation_depth` integer DEFAULT 3 NOT NULL,
	`max_open_descendants` integer DEFAULT 50 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);

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
	`installed_by` text,
	`status` text DEFAULT 'active' NOT NULL,
	`last_inbound_at` integer,
	`poll_minutes` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_socket_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_socket_installed_by_member_id_fk` FOREIGN KEY (`installed_by`) REFERENCES `member`(`id`) ON DELETE SET NULL
);

CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`tracker_socket_id` text NOT NULL,
	`tracker_scope` text NOT NULL,
	`tracker_scope_key` text NOT NULL,
	`forge_socket_id` text,
	`forge_scope` text,
	`docs_socket_id` text,
	`docs_scope` text,
	`default_agent_member_id` text,
	`routing` text DEFAULT '{"labelPrefix":"agent:","mention":true}' NOT NULL,
	`mirror` text DEFAULT 'gates' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`archived_at` integer,
	CONSTRAINT `fk_project_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_tracker_socket_id_socket_id_fk` FOREIGN KEY (`tracker_socket_id`) REFERENCES `socket`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_project_forge_socket_id_socket_id_fk` FOREIGN KEY (`forge_socket_id`) REFERENCES `socket`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_project_docs_socket_id_socket_id_fk` FOREIGN KEY (`docs_socket_id`) REFERENCES `socket`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_project_default_agent_member_id_member_id_fk` FOREIGN KEY (`default_agent_member_id`) REFERENCES `member`(`id`) ON DELETE SET NULL
);

CREATE TABLE `agent` (
	`member_id` text PRIMARY KEY NOT NULL,
	`schedule_minutes` integer,
	`schedule_ran_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_agent_member_id_member_id_fk` FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON DELETE CASCADE
);

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

CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`payload` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_activity_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON DELETE CASCADE
);

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
	CONSTRAINT `fk_run_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_run_agent_member_id_member_id_fk` FOREIGN KEY (`agent_member_id`) REFERENCES `member`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_run_triggered_by_member_id_member_id_fk` FOREIGN KEY (`triggered_by_member_id`) REFERENCES `member`(`id`) ON DELETE SET NULL
);

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
	`created_by` text,
	`external_updated_at` integer NOT NULL,
	`last_synced_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`closed_at` integer,
	CONSTRAINT `fk_issue_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_issue_socket_id_socket_id_fk` FOREIGN KEY (`socket_id`) REFERENCES `socket`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_issue_assignee_member_id_member_id_fk` FOREIGN KEY (`assignee_member_id`) REFERENCES `member`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_issue_created_by_member_id_fk` FOREIGN KEY (`created_by`) REFERENCES `member`(`id`) ON DELETE SET NULL
);

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

CREATE TABLE `channel` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`config` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_channel_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_channel_created_by_member_id_fk` FOREIGN KEY (`created_by`) REFERENCES `member`(`id`) ON DELETE SET NULL
);

CREATE TABLE `notification_preference` (
	`member_id` text NOT NULL,
	`kind` text NOT NULL,
	`inbox` integer DEFAULT true NOT NULL,
	`slack` integer DEFAULT true NOT NULL,
	CONSTRAINT `notification_preference_pk` PRIMARY KEY(`member_id`, `kind`),
	CONSTRAINT `fk_notification_preference_member_id_member_id_fk` FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON DELETE CASCADE
);

CREATE TABLE `routing_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`notification_kind` text,
	`project_id` text,
	`channel_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_routing_rule_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_routing_rule_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_routing_rule_channel_id_channel_id_fk` FOREIGN KEY (`channel_id`) REFERENCES `channel`(`id`) ON DELETE CASCADE
);

CREATE TABLE `delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`target` text NOT NULL,
	`target_id` text NOT NULL,
	`event_seq` integer NOT NULL,
	`recipient_member_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`locked_until` integer,
	`last_status` integer,
	`last_error` text,
	`delivered_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_delivery_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_delivery_event_seq_event_seq_fk` FOREIGN KEY (`event_seq`) REFERENCES `event`(`seq`) ON DELETE CASCADE,
	CONSTRAINT `fk_delivery_recipient_member_id_member_id_fk` FOREIGN KEY (`recipient_member_id`) REFERENCES `member`(`id`) ON DELETE CASCADE
);

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

CREATE INDEX `account_userId_idx` ON `account` (`user_id`);

CREATE INDEX `apikey_configId_idx` ON `apikey` (`config_id`);

CREATE INDEX `apikey_referenceId_idx` ON `apikey` (`reference_id`);

CREATE INDEX `apikey_key_idx` ON `apikey` (`key`);

CREATE INDEX `oauthAccessToken_clientId_idx` ON `oauth_access_token` (`client_id`);

CREATE INDEX `oauthAccessToken_sessionId_idx` ON `oauth_access_token` (`session_id`);

CREATE INDEX `oauthAccessToken_userId_idx` ON `oauth_access_token` (`user_id`);

CREATE INDEX `oauthAccessToken_authorizationCodeId_idx` ON `oauth_access_token` (`authorization_code_id`);

CREATE INDEX `oauthAccessToken_refreshId_idx` ON `oauth_access_token` (`refresh_id`);

CREATE INDEX `oauthClient_userId_idx` ON `oauth_client` (`user_id`);

CREATE UNIQUE INDEX `oauthClientResource_clientId_resourceId_uidx` ON `oauth_client_resource` (`client_id`,`resource_id`);

CREATE INDEX `oauthClientResource_clientId_idx` ON `oauth_client_resource` (`client_id`);

CREATE INDEX `oauthClientResource_resourceId_idx` ON `oauth_client_resource` (`resource_id`);

CREATE INDEX `oauthConsent_clientId_idx` ON `oauth_consent` (`client_id`);

CREATE INDEX `oauthConsent_userId_idx` ON `oauth_consent` (`user_id`);

CREATE INDEX `oauthRefreshToken_clientId_idx` ON `oauth_refresh_token` (`client_id`);

CREATE INDEX `oauthRefreshToken_sessionId_idx` ON `oauth_refresh_token` (`session_id`);

CREATE INDEX `oauthRefreshToken_userId_idx` ON `oauth_refresh_token` (`user_id`);

CREATE INDEX `oauthRefreshToken_authorizationCodeId_idx` ON `oauth_refresh_token` (`authorization_code_id`);

CREATE INDEX `session_userId_idx` ON `session` (`user_id`);

CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);

CREATE UNIQUE INDEX `member_userId_uidx` ON `member` (`user_id`);

CREATE UNIQUE INDEX `member_handle_uidx` ON `member` (`handle`);

CREATE INDEX `member_workspaceId_idx` ON `member` (`workspace_id`);

CREATE INDEX `member_sponsorId_idx` ON `member` (`sponsor_id`);

CREATE INDEX `event_workspaceId_seq_idx` ON `event` (`workspace_id`,`seq`);

CREATE INDEX `event_subject_idx` ON `event` (`subject_type`,`subject_id`);

CREATE INDEX `event_projectId_seq_idx` ON `event` (`project_id`,`seq`);

CREATE UNIQUE INDEX `allowlist_rule_uidx` ON `allowlist_rule` (`workspace_id`,`kind`,`value`);

CREATE INDEX `allowlist_rule_workspaceId_idx` ON `allowlist_rule` (`workspace_id`);

CREATE UNIQUE INDEX `invitation_live_uidx` ON `invitation` (`workspace_id`,`email`) WHERE accepted_at is null and revoked_at is null;

CREATE UNIQUE INDEX `invitation_tokenHash_uidx` ON `invitation` (`token_hash`);

CREATE INDEX `invitation_workspaceId_idx` ON `invitation` (`workspace_id`);

CREATE INDEX `socket_workspaceId_status_idx` ON `socket` (`workspace_id`,`status`);

CREATE UNIQUE INDEX `project_slug_uidx` ON `project` (`workspace_id`,`slug`);

CREATE UNIQUE INDEX `project_tracker_uidx` ON `project` (`tracker_socket_id`,`tracker_scope_key`);

CREATE INDEX `project_workspaceId_idx` ON `project` (`workspace_id`);

CREATE INDEX `project_grant_projectId_idx` ON `project_grant` (`project_id`);

CREATE INDEX `activity_runId_idx` ON `activity` (`run_id`,`created_at`);

CREATE INDEX `run_issueId_idx` ON `run` (`issue_id`,`created_at`);

CREATE INDEX `run_agent_status_idx` ON `run` (`agent_member_id`,`status`);

CREATE INDEX `run_status_lastActivityAt_idx` ON `run` (`status`,`last_activity_at`);

CREATE UNIQUE INDEX `run_open_per_issue_agent_uidx` ON `run` (`issue_id`,`agent_member_id`) WHERE "run"."status" in ('pending', 'active', 'awaiting_input', 'stale');

CREATE UNIQUE INDEX `issue_external_uidx` ON `issue` (`socket_id`,`external_id`);

CREATE INDEX `issue_externalKey_idx` ON `issue` (`external_key`);

CREATE INDEX `issue_url_idx` ON `issue` (`url`);

CREATE INDEX `issue_projectId_state_idx` ON `issue` (`project_id`,`state`);

CREATE INDEX `issue_assignee_idx` ON `issue` (`assignee_member_id`);

CREATE INDEX `issue_parentId_idx` ON `issue` (`parent_id`);

CREATE INDEX `issue_updatedAt_idx` ON `issue` (`updated_at`);

CREATE INDEX `issue_link_issueId_idx` ON `issue_link` (`issue_id`,`created_at`);

CREATE INDEX `notification_recipient_idx` ON `notification` (`recipient_member_id`,`read_at`);

CREATE INDEX `notification_eventId_idx` ON `notification` (`event_id`);

CREATE UNIQUE INDEX `notification_event_uidx` ON `notification` (`recipient_member_id`,`kind`,`event_id`);

CREATE INDEX `channel_workspaceId_idx` ON `channel` (`workspace_id`);

CREATE INDEX `routing_rule_workspaceId_idx` ON `routing_rule` (`workspace_id`);

CREATE INDEX `delivery_due_idx` ON `delivery` (`delivered_at`,`next_attempt_at`);

CREATE INDEX `delivery_target_idx` ON `delivery` (`target_id`,`event_seq`);

CREATE UNIQUE INDEX `delivery_event_uidx` ON `delivery` (`target`,`target_id`,`event_seq`);

CREATE INDEX `webhook_subscription_workspace_idx` ON `webhook_subscription` (`workspace_id`,`disabled_at`);

CREATE INDEX `webhook_subscription_memberId_idx` ON `webhook_subscription` (`member_id`);
