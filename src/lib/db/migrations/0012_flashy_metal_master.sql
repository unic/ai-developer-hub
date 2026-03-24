-- Rename sync_source_type enum value: anthropic_workspace_sync → anthropic_api_costs
-- Step 1: Convert columns to text temporarily
ALTER TABLE "sync_events" ALTER COLUMN "source_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "sync_sources" ALTER COLUMN "source_type" SET DATA TYPE text;--> statement-breakpoint

-- Step 2: Update existing rows with old enum value
UPDATE "sync_events" SET "source_type" = 'anthropic_api_costs' WHERE "source_type" = 'anthropic_workspace_sync';--> statement-breakpoint
UPDATE "sync_sources" SET "source_type" = 'anthropic_api_costs' WHERE "source_type" = 'anthropic_workspace_sync';--> statement-breakpoint

-- Step 3: Drop old enum and create new one
DROP TYPE "public"."sync_source_type";--> statement-breakpoint
CREATE TYPE "public"."sync_source_type" AS ENUM('github_copilot_billing', 'anthropic_api_usage', 'anthropic_team_invoices', 'github_members', 'invoice_period_matching', 'anthropic_api_costs');--> statement-breakpoint

-- Step 4: Cast columns back to enum type
ALTER TABLE "sync_events" ALTER COLUMN "source_type" SET DATA TYPE "public"."sync_source_type" USING "source_type"::"public"."sync_source_type";--> statement-breakpoint
ALTER TABLE "sync_sources" ALTER COLUMN "source_type" SET DATA TYPE "public"."sync_source_type" USING "source_type"::"public"."sync_source_type";
