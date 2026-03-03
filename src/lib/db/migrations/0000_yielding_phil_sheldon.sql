CREATE TYPE "public"."assignment_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."budget_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."change_type" AS ENUM('created', 'updated', 'deleted', 'status_change');--> statement-breakpoint
CREATE TYPE "public"."period_type" AS ENUM('monthly', 'quarterly');--> statement-breakpoint
CREATE TYPE "public"."tool_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "access_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"tool_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"monthly_cost_cents" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_tools" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"vendor" varchar(255) NOT NULL,
	"description" text,
	"max_licenses" integer,
	"status" "tool_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "annual_budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"fiscal_year" integer NOT NULL,
	"total_amount_cents" integer NOT NULL,
	"period_type" "period_type" NOT NULL,
	"status" "budget_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"budget_id" integer NOT NULL,
	"period_label" varchar(20) NOT NULL,
	"period_index" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"planned_amount_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" integer NOT NULL,
	"change_type" "change_type" NOT NULL,
	"field_name" varchar(100),
	"previous_value" text,
	"new_value" text,
	"changed_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "license_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tool_id" integer NOT NULL,
	"tier_id" integer NOT NULL,
	"cost_at_assignment_cents" integer NOT NULL,
	"status" "assignment_status" DEFAULT 'active' NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"github_username" varchar(255),
	"department" varchar(100) NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"preferences" jsonb DEFAULT '{"theme":"system","leanMode":false}'::jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_tiers" ADD CONSTRAINT "access_tiers_tool_id_ai_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."ai_tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_budget_id_annual_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."annual_budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_history" ADD CONSTRAINT "change_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_assignments" ADD CONSTRAINT "license_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_assignments" ADD CONSTRAINT "license_assignments_tool_id_ai_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."ai_tools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_assignments" ADD CONSTRAINT "license_assignments_tier_id_access_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."access_tiers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_tiers_tool_id_idx" ON "access_tiers" USING btree ("tool_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_tiers_tool_name_idx" ON "access_tiers" USING btree ("tool_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_tools_name_idx" ON "ai_tools" USING btree ("name");--> statement-breakpoint
CREATE INDEX "ai_tools_vendor_idx" ON "ai_tools" USING btree ("vendor");--> statement-breakpoint
CREATE UNIQUE INDEX "annual_budgets_fiscal_year_idx" ON "annual_budgets" USING btree ("fiscal_year");--> statement-breakpoint
CREATE INDEX "annual_budgets_status_idx" ON "annual_budgets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "budget_periods_budget_id_idx" ON "budget_periods" USING btree ("budget_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_periods_budget_period_idx" ON "budget_periods" USING btree ("budget_id","period_index");--> statement-breakpoint
CREATE INDEX "change_history_entity_idx" ON "change_history" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "change_history_changed_by_idx" ON "change_history" USING btree ("changed_by");--> statement-breakpoint
CREATE INDEX "change_history_created_at_idx" ON "change_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "license_assignments_user_id_idx" ON "license_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "license_assignments_tool_id_idx" ON "license_assignments" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "license_assignments_tier_id_idx" ON "license_assignments" USING btree ("tier_id");--> statement-breakpoint
CREATE INDEX "license_assignments_status_idx" ON "license_assignments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "license_assignments_active_lookup_idx" ON "license_assignments" USING btree ("user_id","tool_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_department_idx" ON "users" USING btree ("department");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");