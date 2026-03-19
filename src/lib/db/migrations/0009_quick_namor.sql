ALTER TABLE "copilot_billing_snapshots" ADD COLUMN "linked_billed_cost_id" integer;--> statement-breakpoint
ALTER TABLE "github_sync_events" ADD COLUMN "billing_linked" integer;--> statement-breakpoint
ALTER TABLE "github_sync_events" ADD COLUMN "billing_skipped" integer;--> statement-breakpoint
ALTER TABLE "copilot_billing_snapshots" ADD CONSTRAINT "copilot_billing_snapshots_linked_billed_cost_id_billed_costs_id_fk" FOREIGN KEY ("linked_billed_cost_id") REFERENCES "public"."billed_costs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copilot_billing_snapshots_linked_cost_idx" ON "copilot_billing_snapshots" USING btree ("linked_billed_cost_id");