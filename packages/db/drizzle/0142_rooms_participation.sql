CREATE TABLE `rooms_activations` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`room_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`state` text NOT NULL,
	`thread_id` text,
	`epoch` integer NOT NULL,
	`capability_hash` text NOT NULL,
	`revoked` integer DEFAULT 0 NOT NULL,
	`requested_outcome` text,
	`stop_requested` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `rooms_agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `rooms_rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`delivery_id`) REFERENCES `rooms_deliveries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_activations_capability_hash_unique` ON `rooms_activations` (`capability_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_one_active_agent` ON `rooms_activations` (`agent_id`) WHERE "rooms_activations"."state" IN ('dispatching','running','uncertain');--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_activation_delivery` ON `rooms_activations` (`delivery_id`);--> statement-breakpoint
CREATE TABLE `rooms_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`handle` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`instructions` text NOT NULL,
	`project_id` text,
	`thread_id` text,
	`last_seq` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`epoch` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms_rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_agent_handle` ON `rooms_agents` (`room_id`,`handle`);--> statement-breakpoint
CREATE TABLE `rooms_chunks` (
	`message_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`text` text NOT NULL,
	PRIMARY KEY(`message_id`, `sequence`),
	FOREIGN KEY (`message_id`) REFERENCES `rooms_streams`(`message_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rooms_deliveries` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`room_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`message_id` text NOT NULL,
	`state` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`baseline` integer DEFAULT 0 NOT NULL,
	`intent` text NOT NULL,
	`activation_id` text,
	`thread_id` text,
	`outcome` text,
	FOREIGN KEY (`room_id`) REFERENCES `rooms_rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `rooms_agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `rooms_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_deliveries_id_unique` ON `rooms_deliveries` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_delivery_once` ON `rooms_deliveries` (`agent_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `rooms_delivery_work` ON `rooms_deliveries` (`state`,`seq`);--> statement-breakpoint
CREATE TABLE `rooms_invites` (
	`hash` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`role` text NOT NULL,
	`expires` integer NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms_rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rooms_members` (
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`room_id`, `user_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms_rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `rooms_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rooms_messages` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`room_id` text NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`cause_id` text,
	`intent` text NOT NULL,
	`recipients` text NOT NULL,
	`reply_to` text,
	`activation_id` text,
	FOREIGN KEY (`room_id`) REFERENCES `rooms_rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_messages_id_unique` ON `rooms_messages` (`id`);--> statement-breakpoint
CREATE INDEX `rooms_message_order` ON `rooms_messages` (`room_id`,`seq`);--> statement-breakpoint
CREATE INDEX `rooms_message_activation` ON `rooms_messages` (`activation_id`);--> statement-breakpoint
CREATE TABLE `rooms_receipts` (
	`scope` text NOT NULL,
	`request_id` text NOT NULL,
	`payload` text NOT NULL,
	`response` text NOT NULL,
	PRIMARY KEY(`scope`, `request_id`)
);
--> statement-breakpoint
CREATE TABLE `rooms_sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `rooms_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rooms_streams` (
	`message_id` text PRIMARY KEY NOT NULL,
	`activation_id` text NOT NULL,
	`state` text NOT NULL,
	`next_sequence` integer DEFAULT 0 NOT NULL,
	`commit_payload` text,
	FOREIGN KEY (`message_id`) REFERENCES `rooms_messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`activation_id`) REFERENCES `rooms_activations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rooms_users` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`name` text NOT NULL,
	`password` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_users_handle_unique` ON `rooms_users` (`handle`);--> statement-breakpoint
CREATE TABLE `rooms_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`default_agent_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`paused` integer DEFAULT 0 NOT NULL,
	`pause_reason` text,
	`max_activations` integer,
	`activations_used` integer DEFAULT 0 NOT NULL
);
