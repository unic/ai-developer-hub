-- 024-ingestion-filter: Add ingestion filter rules table, extend invoices and ingestion_outcome

-- New enums
DO $$ BEGIN
  CREATE TYPE "public"."filter_field" AS ENUM('vendor', 'invoice_number');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."filter_mode" AS ENUM('whitelist', 'blacklist');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- Extend ingestion_outcome enum with 'filtered' value
ALTER TYPE "public"."ingestion_outcome" ADD VALUE IF NOT EXISTS 'filtered';--> statement-breakpoint

-- New table: ingestion_filters
CREATE TABLE IF NOT EXISTS "ingestion_filters" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"field" "filter_field" NOT NULL,
	"mode" "filter_mode" NOT NULL,
	"value" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- FK: ingestion_filters.created_by -> users.id
DO $$ BEGIN
  ALTER TABLE "ingestion_filters" ADD CONSTRAINT "ingestion_filters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- Index on enabled for filter evaluation queries
CREATE INDEX IF NOT EXISTS "ingestion_filters_enabled_idx" ON "ingestion_filters" USING btree ("enabled");--> statement-breakpoint

-- Add filtered_out column to invoices
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "filtered_out" boolean DEFAULT false NOT NULL;
