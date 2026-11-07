CREATE TABLE `goods_received_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`goods_received_note_id` text NOT NULL,
	`position` integer NOT NULL,
	`product_id` text NOT NULL,
	`purchase_order_line_id` text,
	`name_en` text NOT NULL,
	`name_ur` text,
	`unit` text NOT NULL,
	`qty_milli` integer NOT NULL,
	`unit_cost_paisa` integer NOT NULL,
	`line_total_paisa` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`goods_received_note_id`) REFERENCES `goods_received_notes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_order_line_id`) REFERENCES `purchase_order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "goods_received_lines_integers_check" CHECK("goods_received_lines"."position" = CAST("goods_received_lines"."position" AS INTEGER) AND "goods_received_lines"."qty_milli" = CAST("goods_received_lines"."qty_milli" AS INTEGER) AND "goods_received_lines"."unit_cost_paisa" = CAST("goods_received_lines"."unit_cost_paisa" AS INTEGER) AND "goods_received_lines"."line_total_paisa" = CAST("goods_received_lines"."line_total_paisa" AS INTEGER)),
	CONSTRAINT "goods_received_lines_position_check" CHECK("goods_received_lines"."position" >= 0),
	CONSTRAINT "goods_received_lines_qty_milli_check" CHECK("goods_received_lines"."qty_milli" > 0),
	CONSTRAINT "goods_received_lines_unit_cost_paisa_check" CHECK("goods_received_lines"."unit_cost_paisa" >= 0),
	CONSTRAINT "goods_received_lines_line_total_paisa_check" CHECK("goods_received_lines"."line_total_paisa" >= 0),
	CONSTRAINT "goods_received_lines_unit_check" CHECK("goods_received_lines"."unit" IN ('piece', 'kg', 'litre'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goods_received_lines_goods_received_note_id_position_unique` ON `goods_received_lines` (`goods_received_note_id`,`position`);--> statement-breakpoint
CREATE INDEX `goods_received_lines_product_id_idx` ON `goods_received_lines` (`product_id`);--> statement-breakpoint
CREATE INDEX `goods_received_lines_purchase_order_line_id_idx` ON `goods_received_lines` (`purchase_order_line_id`);--> statement-breakpoint
CREATE TABLE `goods_received_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`grn_no` text NOT NULL,
	`supplier_id` text NOT NULL,
	`purchase_order_id` text,
	`supplier_invoice_no` text NOT NULL,
	`total_paisa` integer NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "goods_received_notes_total_paisa_check" CHECK("goods_received_notes"."total_paisa" = CAST("goods_received_notes"."total_paisa" AS INTEGER) AND "goods_received_notes"."total_paisa" >= 0),
	CONSTRAINT "goods_received_notes_grn_no_check" CHECK(length("goods_received_notes"."grn_no") > 0),
	CONSTRAINT "goods_received_notes_supplier_invoice_no_check" CHECK(length("goods_received_notes"."supplier_invoice_no") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goods_received_notes_grn_no_terminal_id_unique` ON `goods_received_notes` (`grn_no`,`terminal_id`);--> statement-breakpoint
CREATE INDEX `goods_received_notes_store_id_created_at_idx` ON `goods_received_notes` (`store_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `goods_received_notes_supplier_id_idx` ON `goods_received_notes` (`supplier_id`);--> statement-breakpoint
CREATE INDEX `goods_received_notes_purchase_order_id_idx` ON `goods_received_notes` (`purchase_order_id`);--> statement-breakpoint
CREATE TABLE `terminal_grn_sequences` (
	`terminal_id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`next_seq` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "terminal_grn_sequences_next_seq_check" CHECK("terminal_grn_sequences"."next_seq" = CAST("terminal_grn_sequences"."next_seq" AS INTEGER) AND "terminal_grn_sequences"."next_seq" >= 1)
);
