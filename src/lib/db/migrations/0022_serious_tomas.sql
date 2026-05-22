CREATE TYPE "public"."license_request_status" AS ENUM('pending_review', 'approved', 'rejected', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."message_template_kind" AS ENUM('approval', 'completion');--> statement-breakpoint
CREATE TABLE "license_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"form_response_id" text NOT NULL,
	"requester_email" text NOT NULL,
	"requester_name" text NOT NULL,
	"requester_user_id" integer,
	"requested_tool_id" integer NOT NULL,
	"requested_tier_id" integer,
	"form_payload" jsonb NOT NULL,
	"teams_team_id" text NOT NULL,
	"teams_channel_id" text NOT NULL,
	"teams_parent_message_id" text NOT NULL,
	"teams_chat_id" text NOT NULL,
	"status" "license_request_status" DEFAULT 'pending_review' NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp,
	"decision_note" text,
	"completed_by" integer,
	"approval_message_md" text,
	"completion_message_md" text,
	"completed_at" timestamp,
	"assignment_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "license_requests_form_response_id_unique" UNIQUE("form_response_id")
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"tool_id" integer NOT NULL,
	"tier_id" integer,
	"kind" "message_template_kind" NOT NULL,
	"body_md" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "license_requests" ADD CONSTRAINT "license_requests_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_requests" ADD CONSTRAINT "license_requests_requested_tool_id_ai_tools_id_fk" FOREIGN KEY ("requested_tool_id") REFERENCES "public"."ai_tools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_requests" ADD CONSTRAINT "license_requests_requested_tier_id_access_tiers_id_fk" FOREIGN KEY ("requested_tier_id") REFERENCES "public"."access_tiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_requests" ADD CONSTRAINT "license_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_requests" ADD CONSTRAINT "license_requests_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_requests" ADD CONSTRAINT "license_requests_assignment_id_license_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."license_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_tool_id_ai_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."ai_tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_tier_id_access_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."access_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "license_requests_requester_user_id_idx" ON "license_requests" USING btree ("requester_user_id");--> statement-breakpoint
CREATE INDEX "license_requests_requested_tool_id_idx" ON "license_requests" USING btree ("requested_tool_id");--> statement-breakpoint
CREATE INDEX "license_requests_status_idx" ON "license_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "license_requests_decided_by_idx" ON "license_requests" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "license_requests_assignment_id_idx" ON "license_requests" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "license_requests_created_at_idx" ON "license_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "message_templates_tool_id_idx" ON "message_templates" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "message_templates_tier_id_idx" ON "message_templates" USING btree ("tier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_templates_tool_default_kind_idx" ON "message_templates" USING btree ("tool_id","kind") WHERE "message_templates"."tier_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "message_templates_tool_tier_kind_idx" ON "message_templates" USING btree ("tool_id","tier_id","kind") WHERE "message_templates"."tier_id" IS NOT NULL;