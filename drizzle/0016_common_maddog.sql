CREATE TABLE `purchase_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`purchase_order_id` text NOT NULL,
	`position` integer NOT NULL,
	`product_id` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ur` text,
	`unit` text NOT NULL,
	`ordered_qty_milli` integer NOT NULL,
	`unit_cost_paisa` integer NOT NULL,
	`line_total_paisa` integer NOT NULL,
	`received_qty_milli` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchase_order_lines_integers_check" CHECK("purchase_order_lines"."position" = CAST("purchase_order_lines"."position" AS INTEGER) AND "purchase_order_lines"."ordered_qty_milli" = CAST("purchase_order_lines"."ordered_qty_milli" AS INTEGER) AND "purchase_order_lines"."unit_cost_paisa" = CAST("purchase_order_lines"."unit_cost_paisa" AS INTEGER) AND "purchase_order_lines"."line_total_paisa" = CAST("purchase_order_lines"."line_total_paisa" AS INTEGER) AND "purchase_order_lines"."received_qty_milli" = CAST("purchase_order_lines"."received_qty_milli" AS INTEGER)),
	CONSTRAINT "purchase_order_lines_position_check" CHECK("purchase_order_lines"."position" >= 0),
	CONSTRAINT "purchase_order_lines_ordered_qty_milli_check" CHECK("purchase_order_lines"."ordered_qty_milli" > 0),
	CONSTRAINT "purchase_order_lines_unit_cost_paisa_check" CHECK("purchase_order_lines"."unit_cost_paisa" >= 0),
	CONSTRAINT "purchase_order_lines_line_total_paisa_check" CHECK("purchase_order_lines"."line_total_paisa" >= 0),
	CONSTRAINT "purchase_order_lines_received_qty_milli_check" CHECK("purchase_order_lines"."received_qty_milli" >= 0),
	CONSTRAINT "purchase_order_lines_unit_check" CHECK("purchase_order_lines"."unit" IN ('piece', 'kg', 'litre'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_order_lines_purchase_order_id_position_unique` ON `purchase_order_lines` (`purchase_order_id`,`position`) WHERE "purchase_order_lines"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `purchase_order_lines_product_id_idx` ON `purchase_order_lines` (`product_id`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`order_no` text NOT NULL,
	`supplier_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`total_paisa` integer NOT NULL,
	`notes` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchase_orders_status_check" CHECK("purchase_orders"."status" IN ('draft', 'confirmed', 'cancelled')),
	CONSTRAINT "purchase_orders_total_paisa_check" CHECK("purchase_orders"."total_paisa" = CAST("purchase_orders"."total_paisa" AS INTEGER) AND "purchase_orders"."total_paisa" >= 0),
	CONSTRAINT "purchase_orders_order_no_check" CHECK(length("purchase_orders"."order_no") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_order_no_terminal_id_unique` ON `purchase_orders` (`order_no`,`terminal_id`);--> statement-breakpoint
CREATE INDEX `purchase_orders_store_id_created_at_idx` ON `purchase_orders` (`store_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `purchase_orders_supplier_id_idx` ON `purchase_orders` (`supplier_id`);--> statement-breakpoint
CREATE TABLE `terminal_purchase_order_sequences` (
	`terminal_id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`next_seq` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "terminal_purchase_order_sequences_next_seq_check" CHECK("terminal_purchase_order_sequences"."next_seq" = CAST("terminal_purchase_order_sequences"."next_seq" AS INTEGER) AND "terminal_purchase_order_sequences"."next_seq" >= 1)
);
