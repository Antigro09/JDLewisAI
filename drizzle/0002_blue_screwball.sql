CREATE TABLE "takeoff_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"engine_project_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"engine_job_id" text,
	"job_status" text,
	"job_progress" text DEFAULT '' NOT NULL,
	"job_error" text,
	"process_started_at" timestamp,
	"last_polled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "takeoff_projects" ADD CONSTRAINT "takeoff_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "takeoff_projects_user_id_idx" ON "takeoff_projects" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "takeoff_projects_engine_project_id_key" ON "takeoff_projects" USING btree ("engine_project_id");