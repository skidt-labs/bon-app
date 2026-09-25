CREATE TYPE "public"."line_type" AS ENUM('article', 'deposit', 'deposit_return', 'discount', 'loyalty', 'info');--> statement-breakpoint
CREATE TYPE "public"."receipt_source" AS ENUM('camera', 'upload', 'email');--> statement-breakpoint
CREATE TYPE "public"."receipt_status" AS ENUM('pending', 'extracting', 'review', 'confirmed', 'failed');--> statement-breakpoint
CREATE TABLE "extraction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"raw_json" jsonb,
	"duration_ms" integer,
	"item_count" integer,
	"sum_match" boolean,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"address" text,
	"tax_id" text
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	CONSTRAINT "merchants_normalized_name_unique" UNIQUE("normalized_name")
);
--> statement-breakpoint
CREATE TABLE "receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"raw_text" text NOT NULL,
	"line_type" "line_type" DEFAULT 'article' NOT NULL,
	"quantity" text,
	"unit" text,
	"unit_price_cents" integer,
	"total_price_cents" integer NOT NULL,
	"vat_class" text,
	"applies_to_line" integer,
	"corrected" boolean DEFAULT false NOT NULL,
	CONSTRAINT "receipt_items_line_unique" UNIQUE("receipt_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"merchant_id" uuid,
	"merchant_location_id" uuid,
	"merchant_name_raw" text,
	"purchased_at" timestamp with time zone,
	"total_gross_cents" integer,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"payment_method" text,
	"status" "receipt_status" DEFAULT 'pending' NOT NULL,
	"source" "receipt_source" DEFAULT 'camera' NOT NULL,
	"image_path" text NOT NULL,
	"thumb_path" text NOT NULL,
	"needs_review_reason" jsonb,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid
);
--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_locations" ADD CONSTRAINT "merchant_locations_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_merchant_location_id_merchant_locations_id_fk" FOREIGN KEY ("merchant_location_id") REFERENCES "public"."merchant_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_household_status_idx" ON "receipts" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "receipts_purchased_at_idx" ON "receipts" USING btree ("purchased_at");