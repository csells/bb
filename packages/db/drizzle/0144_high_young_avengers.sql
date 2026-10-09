CREATE TABLE `rooms_steering` (
	`id` text PRIMARY KEY NOT NULL,
	`activation_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`text` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`activation_id`) REFERENCES `rooms_activations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rooms_pending_steering` ON `rooms_steering` (`activation_id`,`state`);