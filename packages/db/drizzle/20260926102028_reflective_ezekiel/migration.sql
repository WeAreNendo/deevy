CREATE TABLE `run_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`report` text NOT NULL,
	`harness` text NOT NULL,
	`model` text,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_micro_usd` integer,
	`cost_basis` text,
	`reported_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_run_usage_run_id_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `run_usage_runId_idx` ON `run_usage` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `run_usage_report_model_uidx` ON `run_usage` (`run_id`,`report`,`model`);