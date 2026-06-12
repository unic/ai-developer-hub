-- Renumbered twice: 0023_perfect_runaways → 0024_greedy_ken_ellis (after #102
-- shipped 0023_white_gauntlet) → 0027_ingestion_kind_distinction (after main
-- shipped 0024–0026 while this PR was open).
--
-- IMPORTANT — this migration is intentionally IDEMPOTENT. The original
-- 0023_perfect_runaways was applied to the production database on 2026-06-03
-- directly from this feature branch, before the renumbering. The journal knows
-- nothing of that run, so the migrator treats this file as a brand-new
-- migration and WILL re-run it on production. Every statement below therefore
-- tolerates the objects already existing.
DO $$ BEGIN
  CREATE TYPE "public"."ingestion_kind" AS ENUM('invoice', 'license_request', 'user_import', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."ingestion_source_type" AS ENUM('invoice_pdf', 'ms_forms_license_request', 'csv_user_import');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "ingestion_log" ADD COLUMN IF NOT EXISTS "kind" "ingestion_kind" DEFAULT 'invoice' NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion_log" ADD COLUMN IF NOT EXISTS "source_type" "ingestion_source_type";--> statement-breakpoint
ALTER TABLE "ingestion_log" ADD COLUMN IF NOT EXISTS "label" varchar(500);--> statement-breakpoint
ALTER TABLE "ingestion_log" ADD COLUMN IF NOT EXISTS "entity_type" varchar(40);--> statement-breakpoint
ALTER TABLE "ingestion_log" ADD COLUMN IF NOT EXISTS "entity_id" integer;--> statement-breakpoint
ALTER TABLE "ingestion_log" ADD COLUMN IF NOT EXISTS "details" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingestion_log_kind_idx" ON "ingestion_log" USING btree ("kind");
