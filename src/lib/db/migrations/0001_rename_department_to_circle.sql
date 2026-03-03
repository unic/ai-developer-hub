-- Migration: Rename department column to circle (Holacracy terminology)
ALTER TABLE "users" RENAME COLUMN "department" TO "circle";
ALTER INDEX "users_department_idx" RENAME TO "users_circle_idx";
