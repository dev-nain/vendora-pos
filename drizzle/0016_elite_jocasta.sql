PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_backup_records` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`trigger` text NOT NULL,
	`file_name` text NOT NULL,
	`size_bytes` integer,
	`result` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "backup_records_trigger_check" CHECK("__new_backup_records"."trigger" IN ('daily', 'shift_close', 'manual', 'pre_restore')),
	CONSTRAINT "backup_records_result_check" CHECK("__new_backup_records"."result" IN ('ok', 'failed')),
	CONSTRAINT "backup_records_outcome_check" CHECK(("__new_backup_records"."result" = 'ok' AND "__new_backup_records"."size_bytes" IS NOT NULL AND "__new_backup_records"."error" IS NULL) OR ("__new_backup_records"."result" = 'failed' AND "__new_backup_records"."size_bytes" IS NULL AND "__new_backup_records"."error" IS NOT NULL)),
	CONSTRAINT "backup_records_size_bytes_check" CHECK(("__new_backup_records"."size_bytes" IS NULL OR "__new_backup_records"."size_bytes" = CAST("__new_backup_records"."size_bytes" AS INTEGER)))
);
--> statement-breakpoint
INSERT INTO `__new_backup_records`("id", "store_id", "terminal_id", "trigger", "file_name", "size_bytes", "result", "error", "created_at", "updated_at", "deleted_at") SELECT "id", "store_id", "terminal_id", "trigger", "file_name", "size_bytes", "result", "error", "created_at", "updated_at", "deleted_at" FROM `backup_records`;--> statement-breakpoint
DROP TABLE `backup_records`;--> statement-breakpoint
ALTER TABLE `__new_backup_records` RENAME TO `backup_records`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `backup_records_created_at_idx` ON `backup_records` (`created_at`);