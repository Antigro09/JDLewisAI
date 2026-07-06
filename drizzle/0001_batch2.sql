CREATE TABLE "project_file_embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"file_id" text NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "transcript_retention_days" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "recording_consent_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "recording_consent_text" text;--> statement-breakpoint
ALTER TABLE "project_file_embeddings" ADD CONSTRAINT "project_file_embeddings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_file_embeddings" ADD CONSTRAINT "project_file_embeddings_file_id_project_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."project_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_file_embeddings_project_id_idx" ON "project_file_embeddings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_file_embeddings_file_id_idx" ON "project_file_embeddings" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "project_file_embeddings_embedding_idx" ON "project_file_embeddings" USING hnsw ("embedding" vector_cosine_ops);