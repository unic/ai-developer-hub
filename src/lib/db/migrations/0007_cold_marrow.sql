CREATE TYPE "public"."copilot_sync_type" AS ENUM('members', 'copilot');--> statement-breakpoint
CREATE TABLE "copilot_billing_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"billing_month" date NOT NULL,
	"plan_type" varchar(50) NOT NULL,
	"total_seats" integer NOT NULL,
	"active_seats" integer NOT NULL,
	"seat_cost_cents" integer NOT NULL,
	"total_cost_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copilot_usage_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"date" date NOT NULL,
	"total_active_users" integer NOT NULL,
	"total_engaged_users" integer NOT NULL,
	"total_suggestions" integer NOT NULL,
	"total_acceptances" integer NOT NULL,
	"total_lines_suggested" integer NOT NULL,
	"total_lines_accepted" integer NOT NULL,
	"total_chat_turns" integer,
	"total_chat_acceptances" integer,
	"total_dotcom_chat_turns" integer,
	"total_pr_summaries" integer,
	"language_breakdown" jsonb,
	"editor_breakdown" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_connections" ADD COLUMN "copilot_sync_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "github_connections" ADD COLUMN "copilot_sync_schedule" varchar(50) DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE "github_sync_events" ADD COLUMN "sync_type" "copilot_sync_type" DEFAULT 'members' NOT NULL;--> statement-breakpoint
ALTER TABLE "github_sync_events" ADD COLUMN "seats_processed" integer;--> statement-breakpoint
ALTER TABLE "github_sync_events" ADD COLUMN "metrics_processed" integer;--> statement-breakpoint
ALTER TABLE "github_sync_events" ADD COLUMN "billing_processed" integer;--> statement-breakpoint
ALTER TABLE "license_assignments" ADD COLUMN "source" varchar(50) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "copilot_billing_snapshots" ADD CONSTRAINT "copilot_billing_snapshots_connection_id_github_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."github_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_usage_metrics" ADD CONSTRAINT "copilot_usage_metrics_connection_id_github_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."github_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "copilot_billing_snapshots_connection_month_idx" ON "copilot_billing_snapshots" USING btree ("connection_id","billing_month");--> statement-breakpoint
CREATE UNIQUE INDEX "copilot_usage_metrics_connection_date_idx" ON "copilot_usage_metrics" USING btree ("connection_id","date");--> statement-breakpoint
CREATE INDEX "copilot_usage_metrics_date_idx" ON "copilot_usage_metrics" USING btree ("date");--> statement-breakpoint
DELETE FROM billed_costs WHERE vendor_reference LIKE 'copilot-billing-%';