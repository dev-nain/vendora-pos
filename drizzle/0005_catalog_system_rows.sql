ALTER TABLE `categories` ADD `is_system` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tax_categories` ADD `is_system` integer DEFAULT false NOT NULL;