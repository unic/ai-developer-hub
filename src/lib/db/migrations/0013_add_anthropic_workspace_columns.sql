ALTER TABLE "anthropic_workspaces" ADD COLUMN IF NOT EXISTS "display_color" varchar(20);--> statement-breakpoint
ALTER TABLE "anthropic_workspaces" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "anthropic_workspaces" ADD COLUMN IF NOT EXISTS "anthropic_created_at" timestamp;
