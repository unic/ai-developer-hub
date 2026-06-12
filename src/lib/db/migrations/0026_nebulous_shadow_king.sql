CREATE TABLE "forecast_scenarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"budget_id" integer NOT NULL,
	"name" varchar(60) NOT NULL,
	"params" jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forecast_scenarios" ADD CONSTRAINT "forecast_scenarios_budget_id_annual_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."annual_budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_scenarios" ADD CONSTRAINT "forecast_scenarios_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "forecast_scenarios_budget_id_idx" ON "forecast_scenarios" USING btree ("budget_id");--> statement-breakpoint
CREATE INDEX "forecast_scenarios_created_by_idx" ON "forecast_scenarios" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_scenarios_budget_name_idx" ON "forecast_scenarios" USING btree ("budget_id",lower("name"));