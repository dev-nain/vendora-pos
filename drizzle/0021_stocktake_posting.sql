PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_stocktake_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`stocktake_id` text NOT NULL,
	`product_id` text NOT NULL,
	`expected_qty_milli` integer,
	`counted_qty_milli` integer,
	`counted_at` integer,
	`unit_cost_paisa` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stocktake_id`) REFERENCES `stocktakes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stocktake_lines_integers_check" CHECK(("__new_stocktake_lines"."expected_qty_milli" IS NULL OR "__new_stocktake_lines"."expected_qty_milli" = CAST("__new_stocktake_lines"."expected_qty_milli" AS INTEGER)) AND ("__new_stocktake_lines"."counted_qty_milli" IS NULL OR "__new_stocktake_lines"."counted_qty_milli" = CAST("__new_stocktake_lines"."counted_qty_milli" AS INTEGER)) AND ("__new_stocktake_lines"."unit_cost_paisa" IS NULL OR "__new_stocktake_lines"."unit_cost_paisa" = CAST("__new_stocktake_lines"."unit_cost_paisa" AS INTEGER))),
	CONSTRAINT "stocktake_lines_unit_cost_paisa_check" CHECK("__new_stocktake_lines"."unit_cost_paisa" IS NULL OR "__new_stocktake_lines"."unit_cost_paisa" >= 0),
	CONSTRAINT "stocktake_lines_counted_qty_milli_check" CHECK("__new_stocktake_lines"."counted_qty_milli" IS NULL OR "__new_stocktake_lines"."counted_qty_milli" >= 0),
	CONSTRAINT "stocktake_lines_counted_set_check" CHECK(("__new_stocktake_lines"."counted_qty_milli" IS NULL) = ("__new_stocktake_lines"."counted_at" IS NULL) AND ("__new_stocktake_lines"."expected_qty_milli" IS NULL) = ("__new_stocktake_lines"."counted_at" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_stocktake_lines`("id", "store_id", "terminal_id", "stocktake_id", "product_id", "expected_qty_milli", "counted_qty_milli", "counted_at", "created_at", "updated_at") SELECT "id", "store_id", "terminal_id", "stocktake_id", "product_id", "expected_qty_milli", "counted_qty_milli", "counted_at", "created_at", "updated_at" FROM `stocktake_lines`;--> statement-breakpoint
DROP TABLE `stocktake_lines`;--> statement-breakpoint
ALTER TABLE `__new_stocktake_lines` RENAME TO `stocktake_lines`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `stocktake_lines_stocktake_product_unique` ON `stocktake_lines` (`stocktake_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `__new_stocktakes` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`scope` text NOT NULL,
	`category_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`started_by` text NOT NULL,
	`posted_at` integer,
	`posted_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`posted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stocktakes_scope_check" CHECK("__new_stocktakes"."scope" IN ('full', 'category')),
	CONSTRAINT "stocktakes_status_check" CHECK("__new_stocktakes"."status" IN ('open', 'posted', 'cancelled')),
	CONSTRAINT "stocktakes_scope_category_check" CHECK(("__new_stocktakes"."scope" = 'category') = ("__new_stocktakes"."category_id" IS NOT NULL)),
	CONSTRAINT "stocktakes_posted_check" CHECK(("__new_stocktakes"."status" = 'posted') = ("__new_stocktakes"."posted_at" IS NOT NULL) AND ("__new_stocktakes"."posted_at" IS NULL) = ("__new_stocktakes"."posted_by" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_stocktakes`("id", "store_id", "terminal_id", "scope", "category_id", "status", "started_by", "created_at", "updated_at") SELECT "id", "store_id", "terminal_id", "scope", "category_id", "status", "started_by", "created_at", "updated_at" FROM `stocktakes`;--> statement-breakpoint
DROP TABLE `stocktakes`;--> statement-breakpoint
ALTER TABLE `__new_stocktakes` RENAME TO `stocktakes`;--> statement-breakpoint
CREATE UNIQUE INDEX `stocktakes_store_open_unique` ON `stocktakes` (`store_id`) WHERE "stocktakes"."status" = 'open';