CREATE TABLE `product_barcodes` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`product_id` text NOT NULL,
	`barcode` text NOT NULL,
	`pack_qty_milli` integer DEFAULT 1000 NOT NULL,
	`sale_price_paisa` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "product_barcodes_pack_qty_milli_check" CHECK("product_barcodes"."pack_qty_milli" > 0),
	CONSTRAINT "product_barcodes_sale_price_paisa_check" CHECK("product_barcodes"."sale_price_paisa" IS NULL OR "product_barcodes"."sale_price_paisa" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_barcodes_store_id_barcode_unique` ON `product_barcodes` (`store_id`,`barcode`) WHERE "product_barcodes"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `product_barcodes_product_id_idx` ON `product_barcodes` (`product_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ur` text,
	`search_text` text NOT NULL,
	`category_id` text NOT NULL,
	`tax_category_id` text NOT NULL,
	`brand` text,
	`unit` text NOT NULL,
	`internal_code` text,
	`cost_paisa` integer NOT NULL,
	`sale_price_paisa` integer NOT NULL,
	`mrp_paisa` integer,
	`pct_code` text,
	`low_stock_threshold_milli` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_category_id`) REFERENCES `tax_categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "products_unit_check" CHECK("products"."unit" IN ('piece', 'kg', 'litre')),
	CONSTRAINT "products_cost_paisa_check" CHECK("products"."cost_paisa" >= 0),
	CONSTRAINT "products_sale_price_paisa_check" CHECK("products"."sale_price_paisa" >= 0),
	CONSTRAINT "products_mrp_paisa_check" CHECK("products"."mrp_paisa" IS NULL OR "products"."mrp_paisa" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_store_id_internal_code_unique` ON `products` (`store_id`,`internal_code`) WHERE "products"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `products_store_id_search_text_idx` ON `products` (`store_id`,`search_text`);--> statement-breakpoint
CREATE INDEX `products_category_id_idx` ON `products` (`category_id`);