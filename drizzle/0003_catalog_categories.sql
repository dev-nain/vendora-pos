CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_store_id_name_lower_unique` ON `categories` (`store_id`,lower("name")) WHERE "categories"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `tax_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`name` text NOT NULL,
	`rate_bps` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tax_categories_rate_bps_check" CHECK("tax_categories"."rate_bps" IS NULL OR "tax_categories"."rate_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_categories_store_id_name_lower_unique` ON `tax_categories` (`store_id`,lower("name")) WHERE "tax_categories"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE `stores` ADD `standard_tax_rate_bps` integer DEFAULT 1800 NOT NULL CONSTRAINT "stores_standard_tax_rate_bps_check" CHECK(`standard_tax_rate_bps` BETWEEN 0 AND 10000);
