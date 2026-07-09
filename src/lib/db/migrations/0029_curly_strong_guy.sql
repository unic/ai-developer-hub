CREATE TYPE "public"."license_request_profile" AS ENUM('baseline', 'maxed', 'indie');--> statement-breakpoint
CREATE TABLE "tool_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" "user_discipline",
	"profile" "license_request_profile" NOT NULL,
	"tool_id" integer,
	"default_tier_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "license_requests" ALTER COLUMN "requested_tool_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_tools" ADD COLUMN "requires_api_key" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "license_requests" ADD COLUMN "requester_role" "user_discipline";--> statement-breakpoint
ALTER TABLE "license_requests" ADD COLUMN "requester_profile" "license_request_profile";--> statement-breakpoint
ALTER TABLE "license_requests" ADD COLUMN "justification" text;--> statement-breakpoint
ALTER TABLE "tool_mappings" ADD CONSTRAINT "tool_mappings_tool_id_ai_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."ai_tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_mappings" ADD CONSTRAINT "tool_mappings_default_tier_id_access_tiers_id_fk" FOREIGN KEY ("default_tier_id") REFERENCES "public"."access_tiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tool_mappings_tool_id_idx" ON "tool_mappings" USING btree ("tool_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_mappings_role_profile_idx" ON "tool_mappings" USING btree ("role","profile") WHERE "tool_mappings"."role" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_mappings_any_profile_idx" ON "tool_mappings" USING btree ("profile") WHERE "tool_mappings"."role" IS NULL;