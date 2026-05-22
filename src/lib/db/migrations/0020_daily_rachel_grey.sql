ALTER TABLE "copilot_usage_metrics" ADD COLUMN "used_cli" boolean;--> statement-breakpoint
ALTER TABLE "copilot_usage_metrics" ADD COLUMN "used_agent" boolean;--> statement-breakpoint
ALTER TABLE "copilot_usage_metrics" ADD COLUMN "agent_edit_count" integer;--> statement-breakpoint
ALTER TABLE "copilot_usage_metrics" ADD COLUMN "cli_breakdown" jsonb;