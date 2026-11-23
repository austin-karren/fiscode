CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vault_applied` (
	`plan_id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE `document` ADD `vault_path` text;--> statement-breakpoint
CREATE UNIQUE INDEX `document_vault_path_idx` ON `document` (lower("vault_path")) WHERE "document"."deleted_at" IS NULL AND "document"."vault_path" IS NOT NULL;