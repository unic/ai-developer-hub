CREATE TYPE "public"."budget_extension_category" AS ENUM('new_tool', 'scope_increase', 'seat_increase', 'vendor_price_increase', 'reallocation', 'other');--> statement-breakpoint
CREATE TABLE "budget_extension_period_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"extension_id" integer NOT NULL,
	"period_id" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_extensions" (
	"id" serial PRIMARY KEY NOT NULL,
	"budget_id" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" varchar(120) NOT NULL,
	"description" text,
	"category" "budget_extension_category" NOT NULL,
	"linked_tool_id" integer,
	"effective_date" date NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "budget_extensions_amount_non_zero" CHECK ("budget_extensions"."amount_cents" <> 0)
);
--> statement-breakpoint
-- Add original_amount_cents in three steps so the NOT NULL constraint
-- doesn't reject existing rows: (1) add nullable, (2) backfill from
-- total_amount_cents (the live ceiling = the original ceiling for any
-- budget that hasn't been extended yet), (3) enforce NOT NULL.
ALTER TABLE "annual_budgets" ADD COLUMN "original_amount_cents" integer;--> statement-breakpoint
UPDATE "annual_budgets" SET "original_amount_cents" = "total_amount_cents" WHERE "original_amount_cents" IS NULL;--> statement-breakpoint
ALTER TABLE "annual_budgets" ALTER COLUMN "original_amount_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_extension_period_allocations" ADD CONSTRAINT "budget_extension_period_allocations_extension_id_budget_extensions_id_fk" FOREIGN KEY ("extension_id") REFERENCES "public"."budget_extensions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_extension_period_allocations" ADD CONSTRAINT "budget_extension_period_allocations_period_id_budget_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."budget_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_extensions" ADD CONSTRAINT "budget_extensions_budget_id_annual_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."annual_budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_extensions" ADD CONSTRAINT "budget_extensions_linked_tool_id_ai_tools_id_fk" FOREIGN KEY ("linked_tool_id") REFERENCES "public"."ai_tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_extensions" ADD CONSTRAINT "budget_extensions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bepa_unique_ext_period" ON "budget_extension_period_allocations" USING btree ("extension_id","period_id");--> statement-breakpoint
CREATE INDEX "bepa_period_idx" ON "budget_extension_period_allocations" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "budget_extensions_budget_idx" ON "budget_extensions" USING btree ("budget_id");--> statement-breakpoint
CREATE INDEX "budget_extensions_effective_idx" ON "budget_extensions" USING btree ("effective_date");--> statement-breakpoint
CREATE INDEX "budget_extensions_linked_tool_idx" ON "budget_extensions" USING btree ("linked_tool_id");--> statement-breakpoint
CREATE INDEX "budget_extensions_created_by_idx" ON "budget_extensions" USING btree ("created_by");