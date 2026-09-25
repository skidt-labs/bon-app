ALTER TABLE "households" ADD COLUMN "slug" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_slug_unique" UNIQUE("slug");
