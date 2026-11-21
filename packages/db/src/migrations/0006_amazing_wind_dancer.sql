CREATE TABLE `document` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`added_at` text NOT NULL,
	`notes` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `document_folder_idx` ON `document` (`folder_id`);--> statement-breakpoint
CREATE INDEX `document_sha_idx` ON `document` (`sha256`);--> statement-breakpoint
CREATE TABLE `document_folder` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`tax_year` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`default_key` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_link` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`record_type` text NOT NULL,
	`record_id` text NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `document_link_doc_idx` ON `document_link` (`document_id`);--> statement-breakpoint
CREATE INDEX `document_link_rec_idx` ON `document_link` (`record_type`,`record_id`);