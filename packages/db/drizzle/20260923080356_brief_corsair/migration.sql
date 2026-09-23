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
CREATE INDEX `socket_mirror_gate_idx` ON `socket_mirror` (`gate_request_id`);