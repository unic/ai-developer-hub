CREATE TABLE IF NOT EXISTS "anthropic_org_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"billing_budget_limit_cents" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "anthropic_org_config_id_check" CHECK ("anthropic_org_config"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "anthropic_workspace_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" varchar(100),
	"limit_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'copilot_billing_snapshots_linked_billed_cost_id_billed_costs_id_fk'
  ) THEN
    ALTER TABLE "copilot_billing_snapshots" DROP CONSTRAINT "copilot_billing_snapshots_linked_billed_cost_id_billed_costs_id_fk";
  END IF;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "anthropic_workspace_costs_ws_date_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "anthropic_workspace_costs_null_ws_date_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "copilot_billing_snapshots_linked_cost_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "anthropic_workspaces_workspace_id_idx";--> statement-breakpoint
ALTER TABLE "anthropic_workspaces" ALTER COLUMN "name" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "anthropic_sync_status" ADD COLUMN IF NOT EXISTS "workspace_sync_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "anthropic_workspaces" ADD COLUMN IF NOT EXISTS "display_color" varchar(20);--> statement-breakpoint
ALTER TABLE "anthropic_workspaces" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "anthropic_workspaces" ADD COLUMN IF NOT EXISTS "anthropic_created_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'anthropic_org_config_updated_by_users_id_fk'
  ) THEN
    ALTER TABLE "anthropic_org_config" ADD CONSTRAINT "anthropic_org_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "anthropic_workspace_limits_workspace_id_idx" ON "anthropic_workspace_limits" USING btree ("workspace_id") WHERE "anthropic_workspace_limits"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "anthropic_workspace_limits_default_idx" ON "anthropic_workspace_limits" USING btree ((1)) WHERE "anthropic_workspace_limits"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "anthropic_workspace_costs_workspace_date_idx" ON "anthropic_workspace_costs" USING btree ("workspace_id","date") WHERE "anthropic_workspace_costs"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "anthropic_workspace_costs_default_date_idx" ON "anthropic_workspace_costs" USING btree ("date") WHERE "anthropic_workspace_costs"."workspace_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anthropic_workspace_costs_workspace_id_idx" ON "anthropic_workspace_costs" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "anthropic_workspaces_is_default_idx" ON "anthropic_workspaces" USING btree ("is_default") WHERE "anthropic_workspaces"."is_default" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anthropic_workspaces_archived_idx" ON "anthropic_workspaces" USING btree ("is_archived");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "anthropic_workspaces_workspace_id_idx" ON "anthropic_workspaces" USING btree ("workspace_id") WHERE "anthropic_workspaces"."workspace_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "copilot_billing_snapshots" DROP COLUMN IF EXISTS "linked_billed_cost_id";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'anthropic_workspace_costs_cost_cents_check'
  ) THEN
    ALTER TABLE "anthropic_workspace_costs" ADD CONSTRAINT "anthropic_workspace_costs_cost_cents_check" CHECK ("anthropic_workspace_costs"."cost_cents" >= 0);
  END IF;
END $$;
