ALTER TABLE `stores` ADD `address` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `ntn` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `strn` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `receipt_header_en` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `receipt_header_ur` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `receipt_footer_en` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `receipt_footer_ur` text;--> statement-breakpoint
ALTER TABLE `terminals` ADD `printer_kind` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `terminals` ADD `printer_name` text;--> statement-breakpoint
ALTER TABLE `terminals` ADD `printer_host` text;--> statement-breakpoint
ALTER TABLE `terminals` ADD `printer_port` integer;--> statement-breakpoint
ALTER TABLE `terminals` ADD `paper_width_mm` integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE `terminals` ADD `print_mode` text DEFAULT 'print' NOT NULL;--> statement-breakpoint
CREATE INDEX `sales_terminal_id_created_at_idx` ON `sales` (`terminal_id`,`created_at`);