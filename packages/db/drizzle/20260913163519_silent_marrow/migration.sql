ALTER TABLE `workspace` ADD `max_children_per_issue` integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace` ADD `max_delegation_depth` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace` ADD `max_open_descendants` integer DEFAULT 50 NOT NULL;