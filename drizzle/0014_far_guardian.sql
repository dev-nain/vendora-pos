PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_bill_draft_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`position` integer NOT NULL,
	`product_id` text NOT NULL,
	`qty_milli` integer NOT NULL,
	`is_return` integer DEFAULT false NOT NULL,
	`is_damaged` integer DEFAULT false NOT NULL,
	`refunded_line_id` text,
	`unit_price_paisa` integer NOT NULL,
	`price_type` text DEFAULT 'original' NOT NULL,
	`line_discount_kind` text,
	`line_discount_value` integer,
	`pack_barcode_id` text,
	`pack_qty_milli` integer DEFAULT 1000 NOT NULL,
	`barcode` text,
	`scale_source` text,
	`misc_name` text,
	`deleted_at` integer,
	`deleted_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`draft_id`) REFERENCES `bill_drafts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refunded_line_id`) REFERENCES `sale_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pack_barcode_id`) REFERENCES `product_barcodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_draft_lines_integers_check" CHECK("__new_bill_draft_lines"."position" = CAST("__new_bill_draft_lines"."position" AS INTEGER) AND "__new_bill_draft_lines"."qty_milli" = CAST("__new_bill_draft_lines"."qty_milli" AS INTEGER) AND "__new_bill_draft_lines"."unit_price_paisa" = CAST("__new_bill_draft_lines"."unit_price_paisa" AS INTEGER) AND "__new_bill_draft_lines"."pack_qty_milli" = CAST("__new_bill_draft_lines"."pack_qty_milli" AS INTEGER) AND ("__new_bill_draft_lines"."line_discount_value" IS NULL OR "__new_bill_draft_lines"."line_discount_value" = CAST("__new_bill_draft_lines"."line_discount_value" AS INTEGER))),
	CONSTRAINT "bill_draft_lines_position_check" CHECK("__new_bill_draft_lines"."position" >= 0),
	CONSTRAINT "bill_draft_lines_qty_milli_check" CHECK(("__new_bill_draft_lines"."is_return" = 1 AND "__new_bill_draft_lines"."qty_milli" < 0) OR ("__new_bill_draft_lines"."is_return" = 0 AND "__new_bill_draft_lines"."qty_milli" > 0)),
	CONSTRAINT "bill_draft_lines_refunded_line_id_check" CHECK("__new_bill_draft_lines"."refunded_line_id" IS NULL OR "__new_bill_draft_lines"."is_return" = 1),
	CONSTRAINT "bill_draft_lines_is_damaged_check" CHECK("__new_bill_draft_lines"."is_damaged" = 0 OR "__new_bill_draft_lines"."is_return" = 1),
	CONSTRAINT "bill_draft_lines_unit_price_paisa_check" CHECK("__new_bill_draft_lines"."unit_price_paisa" >= 0),
	CONSTRAINT "bill_draft_lines_pack_qty_milli_check" CHECK("__new_bill_draft_lines"."pack_qty_milli" > 0),
	CONSTRAINT "bill_draft_lines_price_type_check" CHECK("__new_bill_draft_lines"."price_type" IN ('original', 'manual')),
	CONSTRAINT "bill_draft_lines_scale_source_check" CHECK("__new_bill_draft_lines"."scale_source" IS NULL OR "__new_bill_draft_lines"."scale_source" IN ('weight', 'price')),
	CONSTRAINT "bill_draft_lines_line_discount_kind_check" CHECK("__new_bill_draft_lines"."line_discount_kind" IS NULL OR "__new_bill_draft_lines"."line_discount_kind" IN ('amount', 'percent')),
	CONSTRAINT "bill_draft_lines_line_discount_pair_check" CHECK(("__new_bill_draft_lines"."line_discount_kind" IS NULL) = ("__new_bill_draft_lines"."line_discount_value" IS NULL)),
	CONSTRAINT "bill_draft_lines_line_discount_range_check" CHECK("__new_bill_draft_lines"."line_discount_kind" IS NULL OR ("__new_bill_draft_lines"."line_discount_kind" = 'amount' AND "__new_bill_draft_lines"."line_discount_value" >= 0) OR ("__new_bill_draft_lines"."line_discount_kind" = 'percent' AND "__new_bill_draft_lines"."line_discount_value" BETWEEN 0 AND 10000)),
	CONSTRAINT "bill_draft_lines_deleted_pair_check" CHECK(("__new_bill_draft_lines"."deleted_at" IS NULL) = ("__new_bill_draft_lines"."deleted_by" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_bill_draft_lines`("id", "store_id", "terminal_id", "draft_id", "position", "product_id", "qty_milli", "is_return", "is_damaged", "refunded_line_id", "unit_price_paisa", "price_type", "line_discount_kind", "line_discount_value", "pack_barcode_id", "pack_qty_milli", "barcode", "scale_source", "misc_name", "deleted_at", "deleted_by", "created_at", "updated_at") SELECT "id", "store_id", "terminal_id", "draft_id", "position", "product_id", "qty_milli", "is_return", 0, "refunded_line_id", "unit_price_paisa", "price_type", "line_discount_kind", "line_discount_value", "pack_barcode_id", "pack_qty_milli", "barcode", "scale_source", "misc_name", "deleted_at", "deleted_by", "created_at", "updated_at" FROM `bill_draft_lines`;--> statement-breakpoint
DROP TABLE `bill_draft_lines`;--> statement-breakpoint
ALTER TABLE `__new_bill_draft_lines` RENAME TO `bill_draft_lines`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `bill_draft_lines_draft_id_position_unique` ON `bill_draft_lines` (`draft_id`,`position`);