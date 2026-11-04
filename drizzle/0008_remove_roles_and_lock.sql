PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`details` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_audit_log`("id", "store_id", "terminal_id", "actor_user_id", "action", "entity_type", "entity_id", "details", "created_at") SELECT "id", "store_id", "terminal_id", "actor_user_id", "action", "entity_type", "entity_id", "details", "created_at" FROM `audit_log`;--> statement-breakpoint
DROP TABLE `audit_log`;--> statement-breakpoint
ALTER TABLE `__new_audit_log` RENAME TO `audit_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_created_at_idx` ON `audit_log` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_action_created_at_idx` ON `audit_log` (`action`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_stores` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`standard_tax_rate_bps` integer DEFAULT 1800 NOT NULL,
	`scale_weight_prefix` text DEFAULT '21' NOT NULL,
	`scale_price_prefix` text DEFAULT '22' NOT NULL,
	`misc_item_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "stores_standard_tax_rate_bps_check" CHECK("__new_stores"."standard_tax_rate_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "stores_scale_weight_prefix_check" CHECK(length("__new_stores"."scale_weight_prefix") = 2 AND substr("__new_stores"."scale_weight_prefix", 1, 1) BETWEEN '0' AND '9' AND substr("__new_stores"."scale_weight_prefix", 2, 1) BETWEEN '0' AND '9'),
	CONSTRAINT "stores_scale_price_prefix_check" CHECK(length("__new_stores"."scale_price_prefix") = 2 AND substr("__new_stores"."scale_price_prefix", 1, 1) BETWEEN '0' AND '9' AND substr("__new_stores"."scale_price_prefix", 2, 1) BETWEEN '0' AND '9')
);
--> statement-breakpoint
INSERT INTO `__new_stores`("id", "name", "standard_tax_rate_bps", "scale_weight_prefix", "scale_price_prefix", "misc_item_enabled", "created_at", "updated_at") SELECT "id", "name", "standard_tax_rate_bps", "scale_weight_prefix", "scale_price_prefix", "misc_item_enabled", "created_at", "updated_at" FROM `stores`;--> statement-breakpoint
DROP TABLE `stores`;--> statement-breakpoint
ALTER TABLE `__new_stores` RENAME TO `stores`;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`pin_hash` text NOT NULL,
	`failed_pin_attempts` integer DEFAULT 0 NOT NULL,
	`pin_retry_after` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "username", "display_name", "password_hash", "pin_hash", "failed_pin_attempts", "pin_retry_after", "is_active", "deleted_at", "created_at", "updated_at") SELECT "id", "username", "display_name", "password_hash", "pin_hash", "failed_pin_attempts", "pin_retry_after", "is_active", "deleted_at", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_lower_unique` ON `users` (lower("username"));