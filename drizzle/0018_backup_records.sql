CREATE TABLE `backup_records` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`trigger` text NOT NULL,
	`file_name` text NOT NULL,
	`size_bytes` integer,
	`result` text NOT NULL,
	`error` text,
	`copy_folder` text,
	`copy_result` text,
	`copy_error` text,
	`copy_deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "backup_records_trigger_check" CHECK("backup_records"."trigger" IN ('daily', 'shift_close', 'manual', 'pre_restore')),
	CONSTRAINT "backup_records_result_check" CHECK("backup_records"."result" IN ('ok', 'failed')),
	CONSTRAINT "backup_records_outcome_check" CHECK(("backup_records"."result" = 'ok' AND "backup_records"."size_bytes" IS NOT NULL AND "backup_records"."error" IS NULL) OR ("backup_records"."result" = 'failed' AND "backup_records"."size_bytes" IS NULL AND "backup_records"."error" IS NOT NULL)),
	CONSTRAINT "backup_records_size_bytes_check" CHECK(("backup_records"."size_bytes" IS NULL OR "backup_records"."size_bytes" = CAST("backup_records"."size_bytes" AS INTEGER)))
);
--> statement-breakpoint
CREATE INDEX `backup_records_created_at_idx` ON `backup_records` (`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`actor_user_id` text,
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
ALTER TABLE `terminals` ADD `second_copy_folder` text;