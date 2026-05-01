-- Consolidation migration: catches the snapshot chain up to the actual
-- production schema state. Idempotent so it can re-run safely on any DB
-- (production has already had these changes applied via earlier hand-written
-- migrations 0014 and 0016_add_ingestion_filters; preview branches forked
-- from production inherit them).

DO $$ BEGIN
  CREATE TYPE "public"."filter_field" AS ENUM('vendor', 'invoice_number');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."filter_mode" AS ENUM('whitelist', 'blacklist');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TYPE "public"."ingestion_outcome" ADD VALUE IF NOT EXISTS 'filtered';--> statement-breakpoint
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
);
--> statement-breakpoint
ALTER TABLE "copilot_billing_snapshots" DROP CONSTRAINT IF EXISTS "copilot_billing_snapshots_linked_billed_cost_id_billed_costs_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "copilot_billing_snapshots_linked_cost_idx";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "filtered_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ingestion_filters" ADD CONSTRAINT "ingestion_filters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingestion_filters_enabled_idx" ON "ingestion_filters" USING btree ("enabled");--> statement-breakpoint
ALTER TABLE "copilot_billing_snapshots" DROP COLUMN IF EXISTS "linked_billed_cost_id";
