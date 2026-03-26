DO $$ BEGIN
  CREATE TYPE "public"."ingestion_channel" AS ENUM('manual', 'api', 'bulk');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."ingestion_outcome" AS ENUM('success', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingestion_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" varchar(500),
	"vendor" varchar(255),
	"invoice_number" varchar(255),
	"invoice_date" date,
	"amount_cents" integer,
	"outcome" "ingestion_outcome" NOT NULL,
	"error_message" text,
	"channel" "ingestion_channel" NOT NULL,
	"blob_pathname" text,
	"linked_invoice_id" integer,
	"uploaded_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ingestion_log" ADD CONSTRAINT "ingestion_log_linked_invoice_id_invoices_id_fk" FOREIGN KEY ("linked_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ingestion_log" ADD CONSTRAINT "ingestion_log_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingestion_log_outcome_idx" ON "ingestion_log" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingestion_log_created_at_idx" ON "ingestion_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingestion_log_vendor_idx" ON "ingestion_log" USING btree ("vendor");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingestion_log_channel_idx" ON "ingestion_log" USING btree ("channel");
