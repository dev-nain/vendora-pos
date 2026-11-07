CREATE TABLE `purchase_return_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`purchase_return_id` text NOT NULL,
	`position` integer NOT NULL,
	`product_id` text NOT NULL,
	`goods_received_line_id` text,
	`name_en` text NOT NULL,
	`name_ur` text,
	`unit` text NOT NULL,
	`qty_milli` integer NOT NULL,
	`unit_cost_paisa` integer NOT NULL,
	`line_total_paisa` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_return_id`) REFERENCES `purchase_returns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`goods_received_line_id`) REFERENCES `goods_received_lines`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchase_return_lines_integers_check" CHECK("purchase_return_lines"."position" = CAST("purchase_return_lines"."position" AS INTEGER) AND "purchase_return_lines"."qty_milli" = CAST("purchase_return_lines"."qty_milli" AS INTEGER) AND "purchase_return_lines"."unit_cost_paisa" = CAST("purchase_return_lines"."unit_cost_paisa" AS INTEGER) AND "purchase_return_lines"."line_total_paisa" = CAST("purchase_return_lines"."line_total_paisa" AS INTEGER)),
	CONSTRAINT "purchase_return_lines_position_check" CHECK("purchase_return_lines"."position" >= 0),
	CONSTRAINT "purchase_return_lines_qty_milli_check" CHECK("purchase_return_lines"."qty_milli" > 0),
	CONSTRAINT "purchase_return_lines_unit_cost_paisa_check" CHECK("purchase_return_lines"."unit_cost_paisa" >= 0),
	CONSTRAINT "purchase_return_lines_line_total_paisa_check" CHECK("purchase_return_lines"."line_total_paisa" >= 0),
	CONSTRAINT "purchase_return_lines_unit_check" CHECK("purchase_return_lines"."unit" IN ('piece', 'kg', 'litre'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_return_lines_purchase_return_id_position_unique` ON `purchase_return_lines` (`purchase_return_id`,`position`);--> statement-breakpoint
CREATE INDEX `purchase_return_lines_product_id_idx` ON `purchase_return_lines` (`product_id`);--> statement-breakpoint
CREATE INDEX `purchase_return_lines_goods_received_line_id_idx` ON `purchase_return_lines` (`goods_received_line_id`);--> statement-breakpoint
CREATE TABLE `purchase_returns` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`return_no` text NOT NULL,
	`supplier_id` text NOT NULL,
	`goods_received_note_id` text,
	`reason` text NOT NULL,
	`notes` text,
	`total_paisa` integer NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`goods_received_note_id`) REFERENCES `goods_received_notes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchase_returns_total_paisa_check" CHECK("purchase_returns"."total_paisa" = CAST("purchase_returns"."total_paisa" AS INTEGER) AND "purchase_returns"."total_paisa" >= 0),
	CONSTRAINT "purchase_returns_return_no_check" CHECK(length("purchase_returns"."return_no") > 0),
	CONSTRAINT "purchase_returns_reason_check" CHECK("purchase_returns"."reason" IN ('damaged', 'expired', 'wrong_item', 'over_supplied'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_returns_return_no_terminal_id_unique` ON `purchase_returns` (`return_no`,`terminal_id`);--> statement-breakpoint
CREATE INDEX `purchase_returns_store_id_created_at_idx` ON `purchase_returns` (`store_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `purchase_returns_supplier_id_idx` ON `purchase_returns` (`supplier_id`);--> statement-breakpoint
CREATE INDEX `purchase_returns_goods_received_note_id_idx` ON `purchase_returns` (`goods_received_note_id`);--> statement-breakpoint
CREATE TABLE `terminal_purchase_return_sequences` (
	`terminal_id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`next_seq` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "terminal_purchase_return_sequences_next_seq_check" CHECK("terminal_purchase_return_sequences"."next_seq" = CAST("terminal_purchase_return_sequences"."next_seq" AS INTEGER) AND "terminal_purchase_return_sequences"."next_seq" >= 1)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`product_id` text NOT NULL,
	`type` text NOT NULL,
	`qty_milli` integer NOT NULL,
	`unit_cost_paisa` integer NOT NULL,
	`source_type` text,
	`source_id` text,
	`reason` text,
	`actor_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stock_movements_type_check" CHECK("__new_stock_movements"."type" IN ('opening', 'sale', 'return', 'receipt', 'adjustment', 'stocktake', 'damage', 'purchase_return')),
	CONSTRAINT "stock_movements_reason_check" CHECK(("__new_stock_movements"."type" IN ('adjustment', 'damage') AND "__new_stock_movements"."reason" IS NOT NULL AND "__new_stock_movements"."reason" IN ('damage', 'expiry', 'theft', 'correction')) OR ("__new_stock_movements"."type" NOT IN ('adjustment', 'damage') AND "__new_stock_movements"."reason" IS NULL)),
	CONSTRAINT "stock_movements_qty_milli_check" CHECK("__new_stock_movements"."qty_milli" <> 0),
	CONSTRAINT "stock_movements_unit_cost_paisa_check" CHECK("__new_stock_movements"."unit_cost_paisa" >= 0),
	CONSTRAINT "stock_movements_source_check" CHECK(("__new_stock_movements"."source_type" IS NULL) = ("__new_stock_movements"."source_id" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_stock_movements`("id", "store_id", "terminal_id", "product_id", "type", "qty_milli", "unit_cost_paisa", "source_type", "source_id", "reason", "actor_user_id", "created_at") SELECT "id", "store_id", "terminal_id", "product_id", "type", "qty_milli", "unit_cost_paisa", "source_type", "source_id", "reason", "actor_user_id", "created_at" FROM `stock_movements`;--> statement-breakpoint
DROP TABLE `stock_movements`;--> statement-breakpoint
ALTER TABLE `__new_stock_movements` RENAME TO `stock_movements`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `stock_movements_product_id_qty_created_at_idx` ON `stock_movements` (`product_id`,`qty_milli`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_movements_product_id_created_at_idx` ON `stock_movements` (`product_id`,`created_at`);