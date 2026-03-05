CREATE TYPE "public"."user_profile" AS ENUM('boost', 'maxed', 'indie');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "circle" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile" "user_profile";