CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`role` text DEFAULT 'client' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_accounts_username` ON `accounts` (`username`);--> statement-breakpoint
CREATE INDEX `idx_accounts_role_active` ON `accounts` (`role`,`active`);--> statement-breakpoint
INSERT INTO `accounts` (`id`, `username`, `password_hash`, `password_salt`, `name`, `phone`, `role`, `active`, `created_at`)
SELECT `id`, `username`, `password_hash`, `password_salt`, `name`, `phone`, `role`, `active`, `created_at`
FROM `users`
WHERE `username` IS NOT NULL AND `password_hash` IS NOT NULL AND `password_salt` IS NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_bottle_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`quantity` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_bottle_events`("id", "account_id", "kind", "quantity", "note", "created_at") SELECT "id", "user_id", "kind", "quantity", "note", "created_at" FROM `bottle_events`;--> statement-breakpoint
DROP TABLE `bottle_events`;--> statement-breakpoint
ALTER TABLE `__new_bottle_events` RENAME TO `bottle_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_bottle_events_created` ON `bottle_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_bottle_events_account` ON `bottle_events` (`account_id`);--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("token_hash", "user_id", "expires_at", "created_at") SELECT "token_hash", "user_id", "expires_at", "created_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires` ON `sessions` (`expires_at`);--> statement-breakpoint
PRAGMA optimize;
