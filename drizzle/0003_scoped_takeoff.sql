ALTER TABLE "takeoff_projects" ADD COLUMN "takeoff_instructions" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "takeoff_projects" ADD COLUMN "takeoff_scope" jsonb;
