DROP INDEX "budget_kategorien_aktiv_unique";--> statement-breakpoint
ALTER TABLE "budget_kategorien" ADD COLUMN "eigentuemer_id" uuid;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "sichtbarkeit" "sichtbarkeit" DEFAULT 'geteilt' NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "eigentuemer_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_kategorien" ADD CONSTRAINT "budget_kategorien_eigentuemer_id_users_id_fk" FOREIGN KEY ("eigentuemer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_eigentuemer_id_users_id_fk" FOREIGN KEY ("eigentuemer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;