ALTER TABLE `backup_records` ADD `copy_folder` text;--> statement-breakpoint
ALTER TABLE `backup_records` ADD `copy_result` text;--> statement-breakpoint
ALTER TABLE `backup_records` ADD `copy_error` text;--> statement-breakpoint
ALTER TABLE `backup_records` ADD `copy_deleted_at` integer;--> statement-breakpoint
ALTER TABLE `terminals` ADD `second_copy_folder` text;