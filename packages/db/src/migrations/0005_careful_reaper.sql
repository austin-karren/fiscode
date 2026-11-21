CREATE TABLE `estimated_payment` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`jurisdiction` text NOT NULL,
	`tax_year` integer NOT NULL,
	`applied_quarter` integer,
	`notes` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `w2_job` (
	`id` text PRIMARY KEY NOT NULL,
	`tax_year` integer NOT NULL,
	`employer` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`wages_cents` integer DEFAULT 0 NOT NULL,
	`federal_withholding_cents` integer DEFAULT 0 NOT NULL,
	`ss_wages_cents` integer DEFAULT 0 NOT NULL,
	`ss_tax_withheld_cents` integer DEFAULT 0 NOT NULL,
	`medicare_wages_cents` integer DEFAULT 0 NOT NULL,
	`ss_tips_cents` integer DEFAULT 0 NOT NULL,
	`state_wages_cents` integer DEFAULT 0 NOT NULL,
	`state_withholding_cents` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `profile` ADD `prior_year_not_filed` integer;