ALTER TABLE `project` ADD `last_polled_at` integer;--> statement-breakpoint
CREATE INDEX `project_lastPolledAt_idx` ON `project` (`last_polled_at`);