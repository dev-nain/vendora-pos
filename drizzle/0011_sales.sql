CREATE TABLE `bill_draft_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`position` integer NOT NULL,
	`product_id` text NOT NULL,
	`qty_milli` integer NOT NULL,
	`is_return` integer DEFAULT false NOT NULL,
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
	CONSTRAINT "bill_draft_lines_integers_check" CHECK("bill_draft_lines"."position" = CAST("bill_draft_lines"."position" AS INTEGER) AND "bill_draft_lines"."qty_milli" = CAST("bill_draft_lines"."qty_milli" AS INTEGER) AND "bill_draft_lines"."unit_price_paisa" = CAST("bill_draft_lines"."unit_price_paisa" AS INTEGER) AND "bill_draft_lines"."pack_qty_milli" = CAST("bill_draft_lines"."pack_qty_milli" AS INTEGER) AND ("bill_draft_lines"."line_discount_value" IS NULL OR "bill_draft_lines"."line_discount_value" = CAST("bill_draft_lines"."line_discount_value" AS INTEGER))),
	CONSTRAINT "bill_draft_lines_position_check" CHECK("bill_draft_lines"."position" >= 0),
	CONSTRAINT "bill_draft_lines_qty_milli_check" CHECK(("bill_draft_lines"."is_return" = 1 AND "bill_draft_lines"."qty_milli" < 0) OR ("bill_draft_lines"."is_return" = 0 AND "bill_draft_lines"."qty_milli" > 0)),
	CONSTRAINT "bill_draft_lines_refunded_line_id_check" CHECK("bill_draft_lines"."refunded_line_id" IS NULL OR "bill_draft_lines"."is_return" = 1),
	CONSTRAINT "bill_draft_lines_unit_price_paisa_check" CHECK("bill_draft_lines"."unit_price_paisa" >= 0),
	CONSTRAINT "bill_draft_lines_pack_qty_milli_check" CHECK("bill_draft_lines"."pack_qty_milli" > 0),
	CONSTRAINT "bill_draft_lines_price_type_check" CHECK("bill_draft_lines"."price_type" IN ('original', 'manual')),
	CONSTRAINT "bill_draft_lines_scale_source_check" CHECK("bill_draft_lines"."scale_source" IS NULL OR "bill_draft_lines"."scale_source" IN ('weight', 'price')),
	CONSTRAINT "bill_draft_lines_line_discount_kind_check" CHECK("bill_draft_lines"."line_discount_kind" IS NULL OR "bill_draft_lines"."line_discount_kind" IN ('amount', 'percent')),
	CONSTRAINT "bill_draft_lines_line_discount_pair_check" CHECK(("bill_draft_lines"."line_discount_kind" IS NULL) = ("bill_draft_lines"."line_discount_value" IS NULL)),
	CONSTRAINT "bill_draft_lines_line_discount_range_check" CHECK("bill_draft_lines"."line_discount_kind" IS NULL OR ("bill_draft_lines"."line_discount_kind" = 'amount' AND "bill_draft_lines"."line_discount_value" >= 0) OR ("bill_draft_lines"."line_discount_kind" = 'percent' AND "bill_draft_lines"."line_discount_value" BETWEEN 0 AND 10000)),
	CONSTRAINT "bill_draft_lines_deleted_pair_check" CHECK(("bill_draft_lines"."deleted_at" IS NULL) = ("bill_draft_lines"."deleted_by" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_draft_lines_draft_id_position_unique` ON `bill_draft_lines` (`draft_id`,`position`);--> statement-breakpoint
CREATE TABLE `bill_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`held_at` integer,
	`label` text,
	`created_by` text NOT NULL,
	`bill_discount_kind` text,
	`bill_discount_value` integer,
	`buyer_name` text,
	`buyer_ntn` text,
	`buyer_cnic` text,
	`buyer_phone` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_drafts_state_check" CHECK("bill_drafts"."state" IN ('draft', 'paid', 'cancelled')),
	CONSTRAINT "bill_drafts_bill_discount_kind_check" CHECK("bill_drafts"."bill_discount_kind" IS NULL OR "bill_drafts"."bill_discount_kind" IN ('amount', 'percent')),
	CONSTRAINT "bill_drafts_integers_check" CHECK(("bill_drafts"."bill_discount_value" IS NULL OR "bill_drafts"."bill_discount_value" = CAST("bill_drafts"."bill_discount_value" AS INTEGER))),
	CONSTRAINT "bill_drafts_bill_discount_pair_check" CHECK(("bill_drafts"."bill_discount_kind" IS NULL) = ("bill_drafts"."bill_discount_value" IS NULL)),
	CONSTRAINT "bill_drafts_bill_discount_range_check" CHECK("bill_drafts"."bill_discount_kind" IS NULL OR ("bill_drafts"."bill_discount_kind" = 'amount' AND "bill_drafts"."bill_discount_value" >= 0) OR ("bill_drafts"."bill_discount_kind" = 'percent' AND "bill_drafts"."bill_discount_value" BETWEEN 0 AND 10000))
);
--> statement-breakpoint
CREATE INDEX `bill_drafts_shift_id_state_idx` ON `bill_drafts` (`shift_id`,`state`);--> statement-breakpoint
CREATE INDEX `bill_drafts_terminal_id_state_idx` ON `bill_drafts` (`terminal_id`,`state`);--> statement-breakpoint
CREATE TABLE `receipt_prints` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`printed_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`printed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `receipt_prints_sale_id_idx` ON `receipt_prints` (`sale_id`);--> statement-breakpoint
CREATE TABLE `sale_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`position` integer NOT NULL,
	`product_id` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ur` text,
	`unit` text NOT NULL,
	`qty_milli` integer NOT NULL,
	`is_return` integer NOT NULL,
	`unit_price_paisa` integer NOT NULL,
	`mrp_paisa` integer,
	`cost_paisa` integer NOT NULL,
	`tax_rate_bps` integer NOT NULL,
	`is_third_schedule` integer NOT NULL,
	`pct_code` text,
	`gross_paisa` integer NOT NULL,
	`line_discount_paisa` integer NOT NULL,
	`bill_discount_paisa` integer NOT NULL,
	`discount_paisa` integer NOT NULL,
	`tax_paisa` integer NOT NULL,
	`total_paisa` integer NOT NULL,
	`refunded_sale_id` text,
	`refunded_line_id` text,
	`barcode` text,
	`pack_qty_milli` integer DEFAULT 1000 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`,`refunded_sale_id`) REFERENCES `sales`(`id`,`refunded_sale_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refunded_sale_id`,`refunded_line_id`) REFERENCES `sale_lines`(`sale_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sale_lines_unit_check" CHECK("sale_lines"."unit" IN ('piece', 'kg', 'litre')),
	CONSTRAINT "sale_lines_integers_check" CHECK("sale_lines"."position" = CAST("sale_lines"."position" AS INTEGER) AND "sale_lines"."qty_milli" = CAST("sale_lines"."qty_milli" AS INTEGER) AND "sale_lines"."unit_price_paisa" = CAST("sale_lines"."unit_price_paisa" AS INTEGER) AND "sale_lines"."cost_paisa" = CAST("sale_lines"."cost_paisa" AS INTEGER) AND "sale_lines"."tax_rate_bps" = CAST("sale_lines"."tax_rate_bps" AS INTEGER) AND "sale_lines"."gross_paisa" = CAST("sale_lines"."gross_paisa" AS INTEGER) AND "sale_lines"."line_discount_paisa" = CAST("sale_lines"."line_discount_paisa" AS INTEGER) AND "sale_lines"."bill_discount_paisa" = CAST("sale_lines"."bill_discount_paisa" AS INTEGER) AND "sale_lines"."discount_paisa" = CAST("sale_lines"."discount_paisa" AS INTEGER) AND "sale_lines"."tax_paisa" = CAST("sale_lines"."tax_paisa" AS INTEGER) AND "sale_lines"."total_paisa" = CAST("sale_lines"."total_paisa" AS INTEGER) AND "sale_lines"."pack_qty_milli" = CAST("sale_lines"."pack_qty_milli" AS INTEGER) AND ("sale_lines"."mrp_paisa" IS NULL OR "sale_lines"."mrp_paisa" = CAST("sale_lines"."mrp_paisa" AS INTEGER))),
	CONSTRAINT "sale_lines_position_check" CHECK("sale_lines"."position" >= 0),
	CONSTRAINT "sale_lines_signs_check" CHECK(("sale_lines"."is_return" = 1 AND "sale_lines"."qty_milli" < 0 AND "sale_lines"."gross_paisa" <= 0 AND "sale_lines"."line_discount_paisa" <= 0 AND "sale_lines"."bill_discount_paisa" <= 0 AND "sale_lines"."discount_paisa" <= 0 AND "sale_lines"."tax_paisa" <= 0 AND "sale_lines"."total_paisa" <= 0) OR ("sale_lines"."is_return" = 0 AND "sale_lines"."qty_milli" > 0 AND "sale_lines"."gross_paisa" >= 0 AND "sale_lines"."line_discount_paisa" >= 0 AND "sale_lines"."bill_discount_paisa" >= 0 AND "sale_lines"."discount_paisa" >= 0 AND "sale_lines"."tax_paisa" >= 0 AND "sale_lines"."total_paisa" >= 0)),
	CONSTRAINT "sale_lines_unit_price_paisa_check" CHECK("sale_lines"."unit_price_paisa" >= 0),
	CONSTRAINT "sale_lines_cost_paisa_check" CHECK("sale_lines"."cost_paisa" >= 0),
	CONSTRAINT "sale_lines_mrp_paisa_check" CHECK("sale_lines"."mrp_paisa" IS NULL OR "sale_lines"."mrp_paisa" >= 0),
	CONSTRAINT "sale_lines_tax_rate_bps_check" CHECK("sale_lines"."tax_rate_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "sale_lines_pack_qty_milli_check" CHECK("sale_lines"."pack_qty_milli" > 0),
	CONSTRAINT "sale_lines_discount_sum_check" CHECK("sale_lines"."discount_paisa" = "sale_lines"."line_discount_paisa" + "sale_lines"."bill_discount_paisa"),
	CONSTRAINT "sale_lines_refunded_line_id_check" CHECK("sale_lines"."refunded_line_id" IS NULL OR "sale_lines"."is_return" = 1),
	CONSTRAINT "sale_lines_refunded_pair_check" CHECK(("sale_lines"."refunded_line_id" IS NULL) = ("sale_lines"."refunded_sale_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sale_lines_sale_id_position_unique` ON `sale_lines` (`sale_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `sale_lines_sale_id_id_unique` ON `sale_lines` (`sale_id`,`id`);--> statement-breakpoint
CREATE INDEX `sale_lines_product_id_created_at_idx` ON `sale_lines` (`product_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sale_lines_refunded_line_id_idx` ON `sale_lines` (`refunded_line_id`);--> statement-breakpoint
CREATE TABLE `sale_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`position` integer NOT NULL,
	`method` text NOT NULL,
	`amount_paisa` integer NOT NULL,
	`reference` text,
	`is_change` integer DEFAULT false NOT NULL,
	`reverses_payment_id` text,
	`cashier_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cashier_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`,`method`,`reverses_payment_id`) REFERENCES `sale_payments`(`sale_id`,`method`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sale_payments_method_check" CHECK("sale_payments"."method" IN ('cash', 'card', 'bank_transfer', 'jazzcash', 'easypaisa')),
	CONSTRAINT "sale_payments_integers_check" CHECK("sale_payments"."position" = CAST("sale_payments"."position" AS INTEGER) AND "sale_payments"."amount_paisa" = CAST("sale_payments"."amount_paisa" AS INTEGER)),
	CONSTRAINT "sale_payments_position_check" CHECK("sale_payments"."position" >= 0),
	CONSTRAINT "sale_payments_amount_paisa_check" CHECK("sale_payments"."amount_paisa" <> 0),
	CONSTRAINT "sale_payments_is_change_check" CHECK("sale_payments"."is_change" = 0 OR ("sale_payments"."method" = 'cash' AND "sale_payments"."amount_paisa" < 0)),
	CONSTRAINT "sale_payments_reference_check" CHECK("sale_payments"."reference" IS NULL OR ("sale_payments"."method" <> 'cash' AND length("sale_payments"."reference") BETWEEN 1 AND 64)),
	CONSTRAINT "sale_payments_reverses_payment_id_check" CHECK("sale_payments"."reverses_payment_id" IS NULL OR "sale_payments"."reverses_payment_id" <> "sale_payments"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sale_payments_sale_id_position_unique` ON `sale_payments` (`sale_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `sale_payments_sale_id_method_id_unique` ON `sale_payments` (`sale_id`,`method`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sale_payments_reverses_payment_id_unique` ON `sale_payments` (`reverses_payment_id`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`invoice_no` text NOT NULL,
	`type` text NOT NULL,
	`refunded_sale_id` text,
	`cashier_user_id` text NOT NULL,
	`prices_include_tax` integer NOT NULL,
	`subtotal_paisa` integer NOT NULL,
	`discount_paisa` integer NOT NULL,
	`tax_paisa` integer NOT NULL,
	`rounding_paisa` integer NOT NULL,
	`total_paisa` integer NOT NULL,
	`deleted_line_count` integer DEFAULT 0 NOT NULL,
	`buyer_name` text,
	`buyer_ntn` text,
	`buyer_cnic` text,
	`buyer_phone` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`draft_id`) REFERENCES `bill_drafts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refunded_sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cashier_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sales_type_check" CHECK("sales"."type" IN ('sale', 'refund')),
	CONSTRAINT "sales_integers_check" CHECK("sales"."subtotal_paisa" = CAST("sales"."subtotal_paisa" AS INTEGER) AND "sales"."discount_paisa" = CAST("sales"."discount_paisa" AS INTEGER) AND "sales"."tax_paisa" = CAST("sales"."tax_paisa" AS INTEGER) AND "sales"."rounding_paisa" = CAST("sales"."rounding_paisa" AS INTEGER) AND "sales"."total_paisa" = CAST("sales"."total_paisa" AS INTEGER) AND "sales"."deleted_line_count" = CAST("sales"."deleted_line_count" AS INTEGER)),
	CONSTRAINT "sales_deleted_line_count_check" CHECK("sales"."deleted_line_count" >= 0),
	CONSTRAINT "sales_type_total_check" CHECK(("sales"."type" = 'refund') = ("sales"."total_paisa" < 0)),
	CONSTRAINT "sales_refunded_sale_id_check" CHECK("sales"."refunded_sale_id" IS NULL OR "sales"."refunded_sale_id" <> "sales"."id"),
	CONSTRAINT "sales_invoice_no_check" CHECK(length("sales"."invoice_no") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_draft_id_unique` ON `sales` (`draft_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_invoice_no_terminal_id_unique` ON `sales` (`invoice_no`,`terminal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_id_refunded_sale_id_unique` ON `sales` (`id`,`refunded_sale_id`);--> statement-breakpoint
CREATE INDEX `sales_store_id_created_at_idx` ON `sales` (`store_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sales_shift_id_idx` ON `sales` (`shift_id`);--> statement-breakpoint
CREATE INDEX `sales_refunded_sale_id_idx` ON `sales` (`refunded_sale_id`);--> statement-breakpoint
CREATE TABLE `terminal_invoice_sequences` (
	`terminal_id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`next_seq` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "terminal_invoice_sequences_next_seq_check" CHECK("terminal_invoice_sequences"."next_seq" = CAST("terminal_invoice_sequences"."next_seq" AS INTEGER) AND "terminal_invoice_sequences"."next_seq" >= 1)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `is_third_schedule` integer DEFAULT false NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_stores` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`standard_tax_rate_bps` integer DEFAULT 1800 NOT NULL,
	`scale_weight_prefix` text DEFAULT '21' NOT NULL,
	`scale_price_prefix` text DEFAULT '22' NOT NULL,
	`misc_item_enabled` integer DEFAULT false NOT NULL,
	`shift_variance_warn_paisa` integer DEFAULT 0 NOT NULL,
	`prices_include_tax` integer DEFAULT true NOT NULL,
	`cash_rounding_enabled` integer DEFAULT false NOT NULL,
	`cash_rounding_paisa` integer DEFAULT 100 NOT NULL,
	`cash_rounding_cash_only` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "stores_cash_rounding_paisa_check" CHECK("__new_stores"."cash_rounding_paisa" = CAST("__new_stores"."cash_rounding_paisa" AS INTEGER) AND "__new_stores"."cash_rounding_paisa" > 0),
	CONSTRAINT "stores_standard_tax_rate_bps_check" CHECK("__new_stores"."standard_tax_rate_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "stores_scale_weight_prefix_check" CHECK(length("__new_stores"."scale_weight_prefix") = 2 AND substr("__new_stores"."scale_weight_prefix", 1, 1) BETWEEN '0' AND '9' AND substr("__new_stores"."scale_weight_prefix", 2, 1) BETWEEN '0' AND '9'),
	CONSTRAINT "stores_scale_price_prefix_check" CHECK(length("__new_stores"."scale_price_prefix") = 2 AND substr("__new_stores"."scale_price_prefix", 1, 1) BETWEEN '0' AND '9' AND substr("__new_stores"."scale_price_prefix", 2, 1) BETWEEN '0' AND '9')
);
--> statement-breakpoint
INSERT INTO `__new_stores`("id", "name", "standard_tax_rate_bps", "scale_weight_prefix", "scale_price_prefix", "misc_item_enabled", "shift_variance_warn_paisa", "created_at", "updated_at") SELECT "id", "name", "standard_tax_rate_bps", "scale_weight_prefix", "scale_price_prefix", "misc_item_enabled", "shift_variance_warn_paisa", "created_at", "updated_at" FROM `stores`;--> statement-breakpoint
DROP TABLE `stores`;--> statement-breakpoint
ALTER TABLE `__new_stores` RENAME TO `stores`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `terminals` ADD `fbr_pos_id` text;