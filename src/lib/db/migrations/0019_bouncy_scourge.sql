CREATE TABLE "anthropic_alert_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" varchar(100),
	"billing_month" varchar(7) NOT NULL,
	"threshold_80_fired_at" timestamp,
	"threshold_100_fired_at" timestamp,
	"threshold_120_fired_at" timestamp,
	"forecast_at_risk" boolean DEFAULT false NOT NULL,
	"forecast_changed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "anthropic_alert_state_billing_month_format" CHECK ("anthropic_alert_state"."billing_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "anthropic_alert_state_workspace_month_idx" ON "anthropic_alert_state" USING btree ("workspace_id","billing_month") WHERE "anthropic_alert_state"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "anthropic_alert_state_default_month_idx" ON "anthropic_alert_state" USING btree ("billing_month") WHERE "anthropic_alert_state"."workspace_id" IS NULL;--> statement-breakpoint
CREATE INDEX "anthropic_alert_state_month_idx" ON "anthropic_alert_state" USING btree ("billing_month");