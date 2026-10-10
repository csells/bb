ALTER TABLE `rooms_activations` ADD `credential_host_id` text;--> statement-breakpoint
ALTER TABLE `rooms_activations` ADD `credential_path` text;--> statement-breakpoint
ALTER TABLE `rooms_agents` ADD `environment_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_agent_thread` ON `rooms_agents` (`thread_id`);--> statement-breakpoint
ALTER TABLE `rooms_rooms` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `rooms_rooms` ADD `default_environment_id` text;--> statement-breakpoint
ALTER TABLE `rooms_rooms` ADD `section_id` text;