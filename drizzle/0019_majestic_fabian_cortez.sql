CREATE TABLE "einladungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"rolle" "rolle" DEFAULT 'mitglied' NOT NULL,
	"erstellt_von" uuid NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"laeuft_ab_am" timestamp with time zone NOT NULL,
	"eingeloest_am" timestamp with time zone,
	"eingeloest_von" uuid,
	CONSTRAINT "einladungen_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "einladungen" ADD CONSTRAINT "einladungen_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einladungen" ADD CONSTRAINT "einladungen_erstellt_von_users_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einladungen" ADD CONSTRAINT "einladungen_eingeloest_von_users_id_fk" FOREIGN KEY ("eingeloest_von") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;