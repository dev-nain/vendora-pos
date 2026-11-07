DROP INDEX `stock_movements_product_id_idx`;--> statement-breakpoint
CREATE INDEX `stock_movements_product_id_qty_created_at_idx` ON `stock_movements` (`product_id`,`qty_milli`,`created_at`);