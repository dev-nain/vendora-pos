ALTER TABLE `stores` ADD `cashier_discount_limit_bps` integer DEFAULT 500 NOT NULL CONSTRAINT "stores_cashier_discount_limit_bps_check" CHECK(`cashier_discount_limit_bps` BETWEEN 0 AND 10000);
