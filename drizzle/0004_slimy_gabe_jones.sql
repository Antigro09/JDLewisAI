ALTER TABLE "takeoff_projects" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "takeoff_projects" ADD COLUMN "source_message_id" text;--> statement-breakpoint
ALTER TABLE "takeoff_projects" ADD CONSTRAINT "takeoff_projects_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "takeoff_projects_conversation_id_idx" ON "takeoff_projects" USING btree ("conversation_id");