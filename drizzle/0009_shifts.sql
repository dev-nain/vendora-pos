CREATE TABLE `cash_denominations` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`value_paisa` integer NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cash_denominations_value_paisa_check" CHECK("cash_denominations"."value_paisa" > 0),
	CONSTRAINT "cash_denominations_kind_check" CHECK("cash_denominations"."kind" IN ('note', 'coin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cash_denominations_store_id_value_paisa_unique` ON `cash_denominations` (`store_id`,`value_paisa`) WHERE "cash_denominations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `shift_cash_counts` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`denomination_id` text NOT NULL,
	`value_paisa` integer NOT NULL,
	`count` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`denomination_id`) REFERENCES `cash_denominations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shift_cash_counts_value_paisa_check" CHECK("shift_cash_counts"."value_paisa" > 0),
	CONSTRAINT "shift_cash_counts_count_check" CHECK("shift_cash_counts"."count" > 0)
);
--> statement-breakpoint
CREATE INDEX `shift_cash_counts_shift_id_idx` ON `shift_cash_counts` (`shift_id`);--> statement-breakpoint
CREATE TABLE `shift_cash_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_paisa` integer NOT NULL,
	`reason` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_by` text,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shift_cash_moves_kind_check" CHECK("shift_cash_moves"."kind" IN ('in', 'out')),
	CONSTRAINT "shift_cash_moves_amount_paisa_check" CHECK("shift_cash_moves"."amount_paisa" > 0),
	CONSTRAINT "shift_cash_moves_deleted_pair_check" CHECK(("shift_cash_moves"."deleted_at" IS NULL) = ("shift_cash_moves"."deleted_by" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `shift_cash_moves_shift_id_idx` ON `shift_cash_moves` (`shift_id`);--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`opened_by` text NOT NULL,
	`opened_at` integer NOT NULL,
	`opening_float_paisa` integer NOT NULL,
	`closed_by` text,
	`closed_at` integer,
	`counted_cash_paisa` integer,
	`expected_cash_paisa` integer,
	`variance_paisa` integer,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shifts_opening_float_paisa_check" CHECK("shifts"."opening_float_paisa" >= 0),
	CONSTRAINT "shifts_counted_cash_paisa_check" CHECK("shifts"."counted_cash_paisa" IS NULL OR "shifts"."counted_cash_paisa" >= 0),
	CONSTRAINT "shifts_closed_pair_check" CHECK(("shifts"."closed_at" IS NULL) = ("shifts"."closed_by" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shifts_terminal_open_unique` ON `shifts` (`terminal_id`) WHERE "shifts"."closed_at" IS NULL;--> statement-breakpoint
CREATE INDEX `shifts_terminal_id_closed_at_idx` ON `shifts` (`terminal_id`,`closed_at`);--> statement-breakpoint
ALTER TABLE `stores` ADD `shift_variance_warn_paisa` integer DEFAULT 0 NOT NULL;