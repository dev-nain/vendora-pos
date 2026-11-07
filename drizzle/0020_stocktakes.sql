CREATE TABLE `stocktake_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`stocktake_id` text NOT NULL,
	`product_id` text NOT NULL,
	`expected_qty_milli` integer,
	`counted_qty_milli` integer,
	`counted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stocktake_id`) REFERENCES `stocktakes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stocktake_lines_integers_check" CHECK(("stocktake_lines"."expected_qty_milli" IS NULL OR "stocktake_lines"."expected_qty_milli" = CAST("stocktake_lines"."expected_qty_milli" AS INTEGER)) AND ("stocktake_lines"."counted_qty_milli" IS NULL OR "stocktake_lines"."counted_qty_milli" = CAST("stocktake_lines"."counted_qty_milli" AS INTEGER))),
	CONSTRAINT "stocktake_lines_counted_qty_milli_check" CHECK("stocktake_lines"."counted_qty_milli" IS NULL OR "stocktake_lines"."counted_qty_milli" >= 0),
	CONSTRAINT "stocktake_lines_counted_set_check" CHECK(("stocktake_lines"."counted_qty_milli" IS NULL) = ("stocktake_lines"."counted_at" IS NULL) AND ("stocktake_lines"."expected_qty_milli" IS NULL) = ("stocktake_lines"."counted_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stocktake_lines_stocktake_product_unique` ON `stocktake_lines` (`stocktake_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `stocktakes` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`scope` text NOT NULL,
	`category_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`started_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stocktakes_scope_check" CHECK("stocktakes"."scope" IN ('full', 'category')),
	CONSTRAINT "stocktakes_status_check" CHECK("stocktakes"."status" IN ('open', 'posted', 'cancelled')),
	CONSTRAINT "stocktakes_scope_category_check" CHECK(("stocktakes"."scope" = 'category') = ("stocktakes"."category_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stocktakes_store_open_unique` ON `stocktakes` (`store_id`) WHERE "stocktakes"."status" = 'open';