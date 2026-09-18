CREATE TYPE "public"."attribution_mode" AS ENUM('billed', 'apportioned', 'unattributed');--> statement-breakpoint
CREATE TYPE "public"."pricing_model" AS ENUM('seat', 'usage');--> statement-breakpoint
CREATE TABLE "anthropic_workspace_cost_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" varchar(100),
	"date" date NOT NULL,
	"model" varchar(100),
	"cost_type" varchar(40),
	"token_type" varchar(100),
	"context_window" varchar(20),
	"service_tier" varchar(20),
	"inference_geo" varchar(20),
	"cost_microcents" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "anthropic_workspace_cost_items_cost_microcents_check" CHECK ("anthropic_workspace_cost_items"."cost_microcents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "anthropic_workspace_owners" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" varchar(100),
	"user_id" integer NOT NULL,
	"source" varchar(20) DEFAULT 'resolved' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_purchases" (
	"id" serial PRIMARY KEY NOT NULL,
	"tool_id" integer NOT NULL,
	"invoice_id" integer,
	"purchased_at" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"note" varchar(200),
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_purchases_amount_cents_check" CHECK ("credit_purchases"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "access_tiers" ADD COLUMN "pricing_model" "pricing_model" DEFAULT 'seat' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_tools" ADD COLUMN "credit_opening_balance_cents" integer;--> statement-breakpoint
ALTER TABLE "ai_tools" ADD COLUMN "credit_opening_balance_at" date;--> statement-breakpoint
ALTER TABLE "anthropic_usage_metrics" ADD COLUMN "attributed_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "anthropic_usage_metrics" ADD COLUMN "attribution_mode" "attribution_mode";--> statement-breakpoint
ALTER TABLE "anthropic_workspace_limits" ADD COLUMN "confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "anthropic_workspace_limits" ADD COLUMN "confirmed_by" integer;--> statement-breakpoint
ALTER TABLE "anthropic_workspaces" ADD COLUMN "deprecated_at" timestamp;--> statement-breakpoint
ALTER TABLE "anthropic_workspaces" ADD COLUMN "deprecated_reason" varchar(200);--> statement-breakpoint
ALTER TABLE "anthropic_workspace_owners" ADD CONSTRAINT "anthropic_workspace_owners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_purchases" ADD CONSTRAINT "credit_purchases_tool_id_ai_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."ai_tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_purchases" ADD CONSTRAINT "credit_purchases_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_purchases" ADD CONSTRAINT "credit_purchases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "anthropic_workspace_cost_items_grain_idx" ON "anthropic_workspace_cost_items" USING btree ("workspace_id","date",coalesce("model", ''),coalesce("cost_type", ''),coalesce("token_type", ''),coalesce("context_window", ''),coalesce("service_tier", ''),coalesce("inference_geo", '')) WHERE "anthropic_workspace_cost_items"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "anthropic_workspace_cost_items_default_grain_idx" ON "anthropic_workspace_cost_items" USING btree ("date",coalesce("model", ''),coalesce("cost_type", ''),coalesce("token_type", ''),coalesce("context_window", ''),coalesce("service_tier", ''),coalesce("inference_geo", '')) WHERE "anthropic_workspace_cost_items"."workspace_id" IS NULL;--> statement-breakpoint
CREATE INDEX "anthropic_workspace_cost_items_date_idx" ON "anthropic_workspace_cost_items" USING btree ("date");--> statement-breakpoint
CREATE INDEX "anthropic_workspace_cost_items_workspace_date_idx" ON "anthropic_workspace_cost_items" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "anthropic_workspace_owners_workspace_user_idx" ON "anthropic_workspace_owners" USING btree ("workspace_id","user_id") WHERE "anthropic_workspace_owners"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "anthropic_workspace_owners_default_user_idx" ON "anthropic_workspace_owners" USING btree ("user_id") WHERE "anthropic_workspace_owners"."workspace_id" IS NULL;--> statement-breakpoint
CREATE INDEX "anthropic_workspace_owners_user_id_idx" ON "anthropic_workspace_owners" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_purchases_created_by_idx" ON "credit_purchases" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "credit_purchases_tool_purchased_idx" ON "credit_purchases" USING btree ("tool_id","purchased_at");--> statement-breakpoint
CREATE INDEX "credit_purchases_invoice_id_idx" ON "credit_purchases" USING btree ("invoice_id");--> statement-breakpoint
ALTER TABLE "anthropic_workspace_limits" ADD CONSTRAINT "anthropic_workspace_limits_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anthropic_workspace_limits_confirmed_by_idx" ON "anthropic_workspace_limits" USING btree ("confirmed_by");--> statement-breakpoint
-- 045-usage-based-cost-model: data migration.
-- Idempotent, and scoped by explicit id — never a LIKE pattern, which could
-- catch a workspace or tier created after this was written.

-- Seed workspace ownership from the API-key resolution the sync already does.
-- Two filters matter:
--   * JOIN users — anthropic_sync_status carries a userId=0 sentinel row for
--     the global sync lock, which has no users row and would break the FK.
--   * resolved_workspace_id IS NOT NULL — a key that resolves to the DEFAULT
--     workspace stores NULL, and seeding those would make every such user a
--     co-owner of the default workspace, flipping it to `apportioned` for
--     spend that belongs to nobody in particular. Default-workspace spend
--     stays `unattributed` (FR-007), which is the honest answer.
INSERT INTO "anthropic_workspace_owners" ("workspace_id", "user_id", "source")
SELECT s."resolved_workspace_id", s."user_id", 'resolved'
FROM "anthropic_sync_status" s
JOIN "users" u ON u."id" = s."user_id"
WHERE s."resolved_api_key_id" IS NOT NULL
  AND s."resolved_workspace_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- The five Claude Console tiers price an ALLOWANCE, not a seat. Every other
-- tier stays `seat` by the column default. Guarded by name as well as id: on a
-- CI or freshly seeded database the serial ids need not match this snapshot,
-- and flipping whichever tiers happen to hold these ids would be worse than
-- flipping none.
UPDATE "access_tiers"
SET "pricing_model" = 'usage', "updated_at" = now()
WHERE "tool_id" = 2
  AND "id" IN (2, 3, 4, 10, 11)
  AND "name" IN ('boost-starter', 'boost-advanced', 'boost-expert', 'boost-leader', 'indie-profile');--> statement-breakpoint

-- Deprecate the 12 pooled boost-* workspaces. Presentational only: their
-- historical cost rows stay readable and keep counting in historical months.
-- One-shot, not a repeatable maintenance script — a re-run would re-deprecate
-- a workspace an admin had deliberately un-deprecated.
UPDATE "anthropic_workspaces"
SET "deprecated_at" = now(),
    "deprecated_reason" = 'Pooled boost-* workspace retired; licences deactivated in the Claude Console (spec 045)',
    "updated_at" = now()
WHERE "deprecated_at" IS NULL AND "workspace_id" IN (
  'wrkspc_01WwajmfNsthB13NXt2udGGN',
  'wrkspc_01Gg5aVZTTQRpxGVkqhnF14m',
  'wrkspc_01JSJ8QFMfB2EMssRL4WHo9z',
  'wrkspc_01AJitrPisruy7LxCrkwQeBQ',
  'wrkspc_01TJVdk6Bf21EK6pXgwjLE6p',
  'wrkspc_01PmkV3C6HYFQKEjJ4twC7h1',
  'wrkspc_01GjZw5w8bvftpTDN9ek6gf8',
  'wrkspc_01JAZBuDF5xKqQt6gfhSN9YJ',
  'wrkspc_01R7D66G5sKGfzxkujGskZ1S',
  'wrkspc_01NTsZm2xviWx8D6LbwM7Ty8',
  'wrkspc_01JLudCq2Fe5qHchBH1NQD6W',
  'wrkspc_01CzBV9zdUWLrYN1KyTwBLhW'
);
