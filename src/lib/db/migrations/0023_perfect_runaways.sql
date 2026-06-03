CREATE TYPE "public"."ingestion_kind" AS ENUM('invoice', 'license_request', 'user_import', 'other');--> statement-breakpoint
CREATE TYPE "public"."ingestion_source_type" AS ENUM('invoice_pdf', 'ms_forms_license_request', 'csv_user_import');--> statement-breakpoint
ALTER TABLE "ingestion_log" ADD COLUMN "kind" "ingestion_kind" DEFAULT 'invoice' NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion_log" ADD COLUMN "source_type" "ingestion_source_type";--> statement-breakpoint
ALTER TABLE "ingestion_log" ADD COLUMN "label" varchar(500);--> statement-breakpoint
ALTER TABLE "ingestion_log" ADD COLUMN "entity_type" varchar(40);--> statement-breakpoint
ALTER TABLE "ingestion_log" ADD COLUMN "entity_id" integer;--> statement-breakpoint
ALTER TABLE "ingestion_log" ADD COLUMN "details" jsonb;--> statement-breakpoint
CREATE INDEX "ingestion_log_kind_idx" ON "ingestion_log" USING btree ("kind");