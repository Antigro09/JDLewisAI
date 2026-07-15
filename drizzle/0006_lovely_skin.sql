ALTER TABLE "companies" ALTER COLUMN "recording_consent_required" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "speaker_profiles" ADD COLUMN "consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "speaker_profiles" ADD COLUMN "consent_text_version" text;--> statement-breakpoint
ALTER TABLE "speaker_profiles" ADD COLUMN "consent_by_user_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_accepted_version" text;--> statement-breakpoint
ALTER TABLE "speaker_profiles" ADD CONSTRAINT "speaker_profiles_consent_by_user_id_users_id_fk" FOREIGN KEY ("consent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Data migration: recording-consent acknowledgement becomes the fleet-wide
-- baseline (all-party-consent states). Company admins may still opt out in
-- /admin and thereby assume recording-law compliance responsibility.
UPDATE "companies" SET "recording_consent_required" = true;
