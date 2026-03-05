CREATE TABLE "assignment_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignment_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"body" varchar(2000) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billed_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_id" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"invoice_date" date NOT NULL,
	"description" varchar(500) NOT NULL,
	"vendor_reference" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "department" TO "circle";--> statement-breakpoint
DROP INDEX "users_department_idx";--> statement-breakpoint
ALTER TABLE "license_assignments" ADD COLUMN "workspace" varchar(200);--> statement-breakpoint
ALTER TABLE "license_assignments" ADD COLUMN "api_key_encrypted" varchar(700);--> statement-breakpoint
ALTER TABLE "assignment_comments" ADD CONSTRAINT "assignment_comments_assignment_id_license_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."license_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_comments" ADD CONSTRAINT "assignment_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billed_costs" ADD CONSTRAINT "billed_costs_period_id_budget_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."budget_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_comments_assignment_id_idx" ON "assignment_comments" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "assignment_comments_author_id_idx" ON "assignment_comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "assignment_comments_created_at_idx" ON "assignment_comments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "billed_costs_period_id_idx" ON "billed_costs" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "billed_costs_invoice_date_idx" ON "billed_costs" USING btree ("invoice_date");--> statement-breakpoint
CREATE INDEX "users_circle_idx" ON "users" USING btree ("circle");