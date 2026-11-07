ALTER TABLE `sale_lines` ADD `category_id` text REFERENCES categories(id);--> statement-breakpoint
ALTER TABLE `sale_lines` ADD `category_name` text;--> statement-breakpoint
UPDATE `sale_lines`
SET `category_id` = `categories`.`id`, `category_name` = `categories`.`name`
FROM `products`
JOIN `categories` ON `categories`.`id` = `products`.`category_id`
WHERE `products`.`id` = `sale_lines`.`product_id` AND `products`.`is_system` = 0;
