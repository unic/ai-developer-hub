CREATE TYPE "public"."ingestion_channel" AS ENUM('manual', 'api', 'bulk');--> statement-breakpoint
CREATE TYPE "public"."ingestion_outcome" AS ENUM('success', 'failed');--> statement-breakpoint
CREATE TABLE "anthropic_org_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"billing_budget_limit_cents" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "anthropic_org_config_id_check" CHECK ("anthropic_org_config"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "anthropic_workspace_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" varchar(100),
	"limit_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" varchar(500),
	"vendor" varchar(255),
	"invoice_number" varchar(255),
	"invoice_date" date,
	"amount_cents" integer,
	"outcome" "ingestion_outcome" NOT NULL,
	"error_message" text,
	"channel" "ingestion_channel" NOT NULL,
	"blob_pathname" text,
	"linked_invoice_id" integer,
	"uploaded_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "anthropic_workspace_costs_ws_date_idx";--> statement-breakpoint
DROP INDEX "anthropic_workspace_costs_null_ws_date_idx";--> statement-breakpoint
DROP INDEX "anthropic_workspaces_workspace_id_idx";--> statement-breakpoint
ALTER TABLE "anthropic_workspaces" ALTER COLUMN "name" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "anthropic_sync_status" ADD COLUMN "workspace_sync_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "anthropic_workspaces" ADD COLUMN "display_color" varchar(20);--> statement-breakpoint
ALTER TABLE "anthropic_workspaces" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "anthropic_workspaces" ADD COLUMN "anthropic_created_at" timestamp;--> statement-breakpoint
ALTER TABLE "anthropic_org_config" ADD CONSTRAINT "anthropic_org_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_log" ADD CONSTRAINT "ingestion_log_linked_invoice_id_invoices_id_fk" FOREIGN KEY ("linked_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_log" ADD CONSTRAINT "ingestion_log_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "anthropic_workspace_limits_workspace_id_idx" ON "anthropic_workspace_limits" USING btree ("workspace_id") WHERE "anthropic_workspace_limits"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "anthropic_workspace_limits_default_idx" ON "anthropic_workspace_limits" USING btree ((1)) WHERE "anthropic_workspace_limits"."workspace_id" IS NULL;--> statement-breakpoint
CREATE INDEX "ingestion_log_outcome_idx" ON "ingestion_log" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "ingestion_log_created_at_idx" ON "ingestion_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ingestion_log_vendor_idx" ON "ingestion_log" USING btree ("vendor");--> statement-breakpoint
CREATE INDEX "ingestion_log_channel_idx" ON "ingestion_log" USING btree ("channel");--> statement-breakpoint
CREATE UNIQUE INDEX "anthropic_workspace_costs_workspace_date_idx" ON "anthropic_workspace_costs" USING btree ("workspace_id","date") WHERE "anthropic_workspace_costs"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "anthropic_workspace_costs_default_date_idx" ON "anthropic_workspace_costs" USING btree ("date") WHERE "anthropic_workspace_costs"."workspace_id" IS NULL;--> statement-breakpoint
CREATE INDEX "anthropic_workspace_costs_workspace_id_idx" ON "anthropic_workspace_costs" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "anthropic_workspaces_is_default_idx" ON "anthropic_workspaces" USING btree ("is_default") WHERE "anthropic_workspaces"."is_default" = true;--> statement-breakpoint
CREATE INDEX "anthropic_workspaces_archived_idx" ON "anthropic_workspaces" USING btree ("is_archived");--> statement-breakpoint
CREATE UNIQUE INDEX "anthropic_workspaces_workspace_id_idx" ON "anthropic_workspaces" USING btree ("workspace_id") WHERE "anthropic_workspaces"."workspace_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "anthropic_workspace_costs" ADD CONSTRAINT "anthropic_workspace_costs_cost_cents_check" CHECK ("anthropic_workspace_costs"."cost_cents" >= 0);