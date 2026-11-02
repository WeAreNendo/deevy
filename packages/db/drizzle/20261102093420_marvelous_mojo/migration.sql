ALTER TABLE `project` ADD `chat_socket_id` text REFERENCES socket(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `project` ADD `chat_channel` text;