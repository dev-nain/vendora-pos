ALTER TABLE `stores` ADD `auto_lock_minutes` integer DEFAULT 5 CONSTRAINT "stores_auto_lock_minutes_check" CHECK(`auto_lock_minutes` IS NULL OR `auto_lock_minutes` BETWEEN 1 AND 60);
