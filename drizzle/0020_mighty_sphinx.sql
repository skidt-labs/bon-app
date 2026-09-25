CREATE TYPE "public"."sichtbarkeit" AS ENUM('geteilt', 'privat');--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "sichtbarkeit" "sichtbarkeit" DEFAULT 'privat' NOT NULL;