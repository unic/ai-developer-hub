CREATE TYPE "public"."github_connection_status" AS ENUM('active', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."github_sync_status" AS ENUM('in_progress', 'completed', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "github_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_login" varchar(255) NOT NULL,
	"org_id" integer NOT NULL,
	"org_avatar_url" varchar(500),
	"token_encrypted" varchar(700) NOT NULL,
	"token_scopes_csv" varchar(255) NOT NULL,
	"status" "github_connection_status" DEFAULT 'active' NOT NULL,
	"connected_by" integer NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"disconnected_at" timestamp,
	"last_sync_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "github_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"github_id" integer NOT NULL,
	"github_login" varchar(255) NOT NULL,
	"avatar_url" varchar(500),
	"bio" text,
	"public_repos" integer,
	"profile_url" varchar(500),
	"name" varchar(255),
	"email" varchar(255),
	"last_synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_sync_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"triggered_by" integer NOT NULL,
	"status" "github_sync_status" NOT NULL,
	"total_members" integer,
	"matched_count" integer,
	"imported_count" integer,
	"unmatched_count" integer,
	"conflict_count" integer,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_profiles" ADD CONSTRAINT "github_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_sync_events" ADD CONSTRAINT "github_sync_events_connection_id_github_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."github_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_sync_events" ADD CONSTRAINT "github_sync_events_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_connections_status_idx" ON "github_connections" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "github_profiles_user_id_idx" ON "github_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "github_profiles_github_id_idx" ON "github_profiles" USING btree ("github_id");--> statement-breakpoint
CREATE INDEX "github_profiles_github_login_idx" ON "github_profiles" USING btree ("github_login");--> statement-breakpoint
CREATE INDEX "github_sync_events_connection_id_idx" ON "github_sync_events" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "github_sync_events_triggered_by_idx" ON "github_sync_events" USING btree ("triggered_by");