CREATE TABLE `stock_movements` (
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
	CONSTRAINT "stock_movements_type_check" CHECK("stock_movements"."type" IN ('opening', 'sale', 'return', 'receipt', 'adjustment', 'stocktake', 'damage')),
	CONSTRAINT "stock_movements_reason_check" CHECK(("stock_movements"."type" IN ('adjustment', 'damage') AND "stock_movements"."reason" IS NOT NULL AND "stock_movements"."reason" IN ('damage', 'expiry', 'theft', 'correction')) OR ("stock_movements"."type" NOT IN ('adjustment', 'damage') AND "stock_movements"."reason" IS NULL)),
	CONSTRAINT "stock_movements_qty_milli_check" CHECK("stock_movements"."qty_milli" <> 0),
	CONSTRAINT "stock_movements_unit_cost_paisa_check" CHECK("stock_movements"."unit_cost_paisa" >= 0),
	CONSTRAINT "stock_movements_source_check" CHECK(("stock_movements"."source_type" IS NULL) = ("stock_movements"."source_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `stock_movements_product_id_idx` ON `stock_movements` (`product_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_product_id_created_at_idx` ON `stock_movements` (`product_id`,`created_at`);