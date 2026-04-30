-- nighthawk-agent-auth: Add is_agent flag to users table.
-- Used by the nighthawk agentic workflow to authenticate against preview
-- deployments via /api/agent/session. Defaults to false; existing rows are
-- correctly classified as humans without backfill.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_agent" boolean DEFAULT false NOT NULL;
