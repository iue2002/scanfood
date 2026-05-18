ALTER TABLE `order_items` ADD `phase` varchar(20) DEFAULT 'order' NOT NULL;--> statement-breakpoint
ALTER TABLE `order_items` ADD `add_more_round` int DEFAULT 0 NOT NULL;