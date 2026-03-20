-- 019-invoice-automations: Unified sync framework + workspace tables
-- Safely handles pre-existing objects from earlier features

-- New enums (sync framework)
DO $$ BEGIN CREATE TYPE "public"."sync_operation_type" AS ENUM('regular', 'backfill'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."sync_outcome" AS ENUM('in_progress', 'success', 'partial', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."sync_source_type" AS ENUM('github_copilot_billing', 'anthropic_api_usage', 'anthropic_team_invoices', 'github_members', 'invoice_period_matching', 'anthropic_workspace_sync'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- Pre-existing enums/tables that may already exist from earlier features
DO $$ BEGIN CREATE TYPE "public"."invite_token_status" AS ENUM('active', 'consumed', 'invalidated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "anthropic_sync_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"last_sync_started_at" timestamp,
	"last_sync_completed_at" timestamp,
	"last_sync_error" varchar(500),
	"synced_days" integer DEFAULT 0 NOT NULL,
	"resolved_api_key_id" varchar(100)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "anthropic_usage_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"date" date NOT NULL,
	"model" varchar(100) NOT NULL,
	"uncached_input_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_input_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_creation_input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"computed_cost_cents" integer DEFAULT 0 NOT NULL,
	"pricing_resolved" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invite_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"status" "invite_token_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"consumed_at" timestamp
);--> statement-breakpoint

-- New tables (019)
CREATE TABLE IF NOT EXISTS "anthropic_workspace_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" varchar(100),
	"date" date NOT NULL,
	"cost_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "anthropic_workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" varchar(100),
	"name" varchar(255) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_type" "sync_source_type" NOT NULL,
	"operation_type" "sync_operation_type" DEFAULT 'regular' NOT NULL,
	"backfill_start_date" date,
	"outcome" "sync_outcome" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"triggered_by" integer,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_type" "sync_source_type" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cron_schedule" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Alter existing tables (safe — SET DEFAULT and SET NOT NULL are idempotent)
UPDATE "billed_costs" SET "vendor_reference" = '' WHERE "vendor_reference" IS NULL;--> statement-breakpoint
ALTER TABLE "billed_costs" ALTER COLUMN "vendor_reference" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "billed_costs" ALTER COLUMN "vendor_reference" SET NOT NULL;--> statement-breakpoint

-- Pre-existing column additions (safe with IF NOT EXISTS-like approach)
DO $$ BEGIN ALTER TABLE "github_sync_events" ADD COLUMN "manually_matched_count" integer; EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "github_sync_events" ADD COLUMN "created_count" integer; EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT true NOT NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint

-- Foreign keys (safe — use IF NOT EXISTS pattern)
DO $$ BEGIN ALTER TABLE "anthropic_usage_metrics" ADD CONSTRAINT "anthropic_usage_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invite_tokens" ADD CONSTRAINT "invite_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- Indexes (CREATE INDEX IF NOT EXISTS)
CREATE UNIQUE INDEX IF NOT EXISTS "anthropic_sync_status_user_id_idx" ON "anthropic_sync_status" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "anthropic_usage_metrics_user_date_model_idx" ON "anthropic_usage_metrics" USING btree ("user_id","date","model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anthropic_usage_metrics_user_date_idx" ON "anthropic_usage_metrics" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anthropic_usage_metrics_date_idx" ON "anthropic_usage_metrics" USING btree ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anthropic_usage_metrics_pricing_resolved_idx" ON "anthropic_usage_metrics" USING btree ("pricing_resolved");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "anthropic_workspace_costs_ws_date_idx" ON "anthropic_workspace_costs" USING btree ("workspace_id","date") WHERE "anthropic_workspace_costs"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "anthropic_workspace_costs_null_ws_date_idx" ON "anthropic_workspace_costs" USING btree ("date") WHERE "anthropic_workspace_costs"."workspace_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anthropic_workspace_costs_date_idx" ON "anthropic_workspace_costs" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "anthropic_workspaces_workspace_id_idx" ON "anthropic_workspaces" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invite_tokens_token_hash_idx" ON "invite_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invite_tokens_user_id_idx" ON "invite_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invite_tokens_active_user_idx" ON "invite_tokens" USING btree ("user_id") WHERE "invite_tokens"."status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_events_source_type_idx" ON "sync_events" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_events_outcome_idx" ON "sync_events" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_events_started_at_idx" ON "sync_events" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_events_source_started_idx" ON "sync_events" USING btree ("source_type","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sync_sources_source_type_idx" ON "sync_sources" USING btree ("source_type");--> statement-breakpoint

-- Data migration: migrate github_sync_events → sync_events
INSERT INTO "sync_events" (
  "source_type", "operation_type", "outcome",
  "started_at", "completed_at", "triggered_by",
  "created_count", "updated_count", "skipped_count",
  "error_count", "error_message", "created_at"
)
SELECT
  CASE sync_type
    WHEN 'copilot'  THEN 'github_copilot_billing'::"sync_source_type"
    WHEN 'members'  THEN 'github_members'::"sync_source_type"
  END,
  'regular'::"sync_operation_type",
  CASE status
    WHEN 'completed'   THEN 'success'::"sync_outcome"
    WHEN 'partial'     THEN 'partial'::"sync_outcome"
    WHEN 'failed'      THEN 'failed'::"sync_outcome"
    WHEN 'in_progress' THEN 'in_progress'::"sync_outcome"
  END,
  started_at,
  completed_at,
  triggered_by,
  COALESCE(billing_linked, 0),
  0,
  COALESCE(billing_skipped, 0),
  0,
  error_message,
  started_at
FROM "github_sync_events"
WHERE sync_type IN ('copilot', 'members')
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Data migration: migrate anthropic_sync_status → sync_events (usage sync)
INSERT INTO "sync_events" (
  "source_type", "operation_type", "outcome",
  "started_at", "completed_at",
  "created_count", "error_message", "created_at"
)
SELECT
  'anthropic_api_usage'::"sync_source_type",
  'regular'::"sync_operation_type",
  CASE
    WHEN last_sync_error IS NOT NULL THEN 'failed'::"sync_outcome"
    WHEN last_sync_completed_at IS NOT NULL THEN 'success'::"sync_outcome"
    ELSE 'in_progress'::"sync_outcome"
  END,
  last_sync_started_at,
  last_sync_completed_at,
  COALESCE(synced_days, 0),
  last_sync_error,
  COALESCE(last_sync_started_at, now())
FROM "anthropic_sync_status"
WHERE user_id = 0
  AND last_sync_started_at IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Seed sync_sources registry
INSERT INTO "sync_sources" ("source_type", "enabled", "cron_schedule") VALUES
  ('github_copilot_billing',   true,  '0 6 * * *'),
  ('anthropic_api_usage',      true,  '0 * * * *'),
  ('anthropic_team_invoices',  true,  NULL),
  ('github_members',           true,  NULL),
  ('invoice_period_matching',  true,  NULL),
  ('anthropic_workspace_sync', true,  '0 * * * *')
ON CONFLICT DO NOTHING;
