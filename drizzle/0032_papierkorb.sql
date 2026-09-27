ALTER TYPE "public"."receipt_status" ADD VALUE 'verworfen';--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "verworfen_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "verworfen_von" uuid;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "status_vor_verwerfen" "receipt_status";--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_verworfen_von_users_id_fk" FOREIGN KEY ("verworfen_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;