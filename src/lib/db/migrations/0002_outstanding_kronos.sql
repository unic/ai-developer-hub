DO $$ BEGIN CREATE TYPE "public"."user_profile" AS ENUM('boost', 'maxed', 'indie'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "circle" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "users" ADD COLUMN "profile" "user_profile"; EXCEPTION WHEN duplicate_column THEN null; END $$;