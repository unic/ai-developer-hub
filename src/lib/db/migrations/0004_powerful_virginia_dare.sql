ALTER TABLE "invoices" ADD COLUMN "vendor" varchar(255);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "linked_billed_cost_id" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_linked_billed_cost_id_billed_costs_id_fk" FOREIGN KEY ("linked_billed_cost_id") REFERENCES "public"."billed_costs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_invoice_number_idx" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_created_at_idx" ON "invoices" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_linked_billed_cost_id_idx" ON "invoices" USING btree ("linked_billed_cost_id");