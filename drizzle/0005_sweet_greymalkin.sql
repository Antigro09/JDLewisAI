CREATE TABLE "desktop_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"company_id" text NOT NULL,
	"version" text NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "desktop_entitled_major" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_clients" ADD CONSTRAINT "desktop_clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_clients" ADD CONSTRAINT "desktop_clients_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "desktop_clients_user_id_key" ON "desktop_clients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "desktop_clients_company_id_idx" ON "desktop_clients" USING btree ("company_id");