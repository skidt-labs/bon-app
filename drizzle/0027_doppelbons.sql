ALTER TYPE "public"."receipt_status" ADD VALUE 'doppelt';--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "vermutetes_original_id" uuid;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_vermutetes_original_id_receipts_id_fk" FOREIGN KEY ("vermutetes_original_id") REFERENCES "public"."receipts"("id") ON DELETE set null ON UPDATE no action;