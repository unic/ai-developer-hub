ALTER TABLE "anthropic_workspaces" ADD COLUMN "display_color" varchar(20);--> statement-breakpoint
ALTER TABLE "anthropic_workspaces" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "anthropic_workspaces" ADD COLUMN "anthropic_created_at" timestamp;
