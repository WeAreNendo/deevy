ALTER TABLE `run` ADD `waiting_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `run` ADD `waiting_since` integer;