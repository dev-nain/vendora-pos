PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_stores` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`cashier_discount_limit_bps` integer DEFAULT 500 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "stores_cashier_discount_limit_bps_check" CHECK("__new_stores"."cashier_discount_limit_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
INSERT INTO `__new_stores`("id", "name", "cashier_discount_limit_bps", "created_at", "updated_at") SELECT "id", "name", 500, "created_at", "updated_at" FROM `stores`;--> statement-breakpoint
DROP TABLE `stores`;--> statement-breakpoint
ALTER TABLE `__new_stores` RENAME TO `stores`;--> statement-breakpoint
PRAGMA foreign_keys=ON;