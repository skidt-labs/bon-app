ALTER TYPE "public"."receipt_source" ADD VALUE 'matrix';--> statement-breakpoint
CREATE TABLE "matrix_bot_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"since_token" text,
	"last_sync_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "matrix_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"matrix_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matrix_links_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "matrix_links_matrix_user_id_unique" UNIQUE("matrix_user_id")
);
--> statement-breakpoint
CREATE TABLE "matrix_pairing_attempts" (
	"matrix_user_id" text PRIMARY KEY NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matrix_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matrix_pairing_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "matrix_event_id" text;--> statement-breakpoint
ALTER TABLE "matrix_links" ADD CONSTRAINT "matrix_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matrix_pairing_codes" ADD CONSTRAINT "matrix_pairing_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_matrix_event_id_unique" UNIQUE("matrix_event_id");