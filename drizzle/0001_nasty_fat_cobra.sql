ALTER TABLE `users` ADD `auth_user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_auth_user_id` ON `users` (`auth_user_id`);