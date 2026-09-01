CREATE TABLE "agent_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"agent_type" text DEFAULT 'aux_contable' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"business_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sync_schedule" text DEFAULT '0 */6 * * *' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_config_org_id_unique" UNIQUE("org_id"),
	CONSTRAINT "agent_config_agent_type_check" CHECK ("agent_config"."agent_type" in ('aux_contable'))
);
--> statement-breakpoint
CREATE TABLE "app_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider_key" text NOT NULL,
	"base_url" text NOT NULL,
	"auth_type" text NOT NULL,
	"auth_header_name" text,
	"encrypted_token" text NOT NULL,
	"entered_by_user_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_connections_org_provider_unique" UNIQUE("org_id","provider_key"),
	CONSTRAINT "app_connections_auth_type_check" CHECK ("app_connections"."auth_type" in ('bearer_token','api_key_header','basic'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text,
	"org_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dian_sync_cursor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_external_document_id" text,
	CONSTRAINT "dian_sync_cursor_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by" text,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_run_id_unique" UNIQUE("run_id"),
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('queued','claimed','done','failed'))
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"org_id" uuid NOT NULL,
	"role" text NOT NULL,
	"invited_by" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_user_org_unique" UNIQUE("user_id","org_id"),
	CONSTRAINT "membership_role_check" CHECK ("membership"."role" in ('operator','viewer'))
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"agent_type" text DEFAULT 'aux_contable' NOT NULL,
	"trigger_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_trigger_check" CHECK ("runs"."trigger_type" in ('dian_sync','chat_request','invoice_request')),
	CONSTRAINT "runs_status_check" CHECK ("runs"."status" in ('queued','running','succeeded','failed','cancelled','budget_exceeded'))
);
--> statement-breakpoint
CREATE TABLE "steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "steps_run_ordinal_unique" UNIQUE("run_id","ordinal"),
	CONSTRAINT "steps_kind_check" CHECK ("steps"."kind" in ('model','tool'))
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"args" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"result" jsonb,
	"error" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_calls_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_id" uuid,
	"model_id" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"period" date NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"tokens_total" integer DEFAULT 0 NOT NULL,
	"cost_total_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_events_org_period_unique" UNIQUE("org_id","period")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"platform_role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "platform_role_check" CHECK ("user"."platform_role" is null or "user"."platform_role" in ('geifem_admin'))
);
--> statement-breakpoint
CREATE TABLE "weekly_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"audience" text NOT NULL,
	"content" text NOT NULL,
	"generated_from" jsonb NOT NULL,
	"sent_email_at" timestamp with time zone,
	"sent_whatsapp_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_report_org_period_audience_unique" UNIQUE("org_id","period_start","audience"),
	CONSTRAINT "weekly_report_audience_check" CHECK ("weekly_report"."audience" in ('client','operator'))
);
--> statement-breakpoint
ALTER TABLE "agent_config" ADD CONSTRAINT "agent_config_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_connections" ADD CONSTRAINT "app_connections_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_connections" ADD CONSTRAINT "app_connections_entered_by_user_id_user_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dian_sync_cursor" ADD CONSTRAINT "dian_sync_cursor_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steps" ADD CONSTRAINT "steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_step_id_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traces" ADD CONSTRAINT "traces_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traces" ADD CONSTRAINT "traces_step_id_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_report" ADD CONSTRAINT "weekly_report_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_status_run_after_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "membership_org_id_idx" ON "membership" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "membership_user_id_idx" ON "membership" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "runs_org_status_idx" ON "runs" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "runs_org_created_idx" ON "runs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "tool_calls_step_id_idx" ON "tool_calls" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "traces_run_id_idx" ON "traces" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "usage_events_org_id_idx" ON "usage_events" USING btree ("org_id");