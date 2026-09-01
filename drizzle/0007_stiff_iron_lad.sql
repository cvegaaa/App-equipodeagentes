CREATE TABLE "connector_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotent" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_operations_method_check" CHECK ("connector_operations"."method" in ('GET','POST','PUT','PATCH','DELETE')),
	CONSTRAINT "connector_operations_source_check" CHECK ("connector_operations"."source" in ('manual','imported'))
);
--> statement-breakpoint
CREATE TABLE "custom_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_by_user_id" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"system_prompt" text NOT NULL,
	"connector_id" uuid,
	"enabled_tool_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"moderation_status" text DEFAULT 'none' NOT NULL,
	"moderated_by_user_id" text,
	"moderated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_agents_status_check" CHECK ("custom_agents"."status" in ('draft','active','archived')),
	CONSTRAINT "custom_agents_visibility_check" CHECK ("custom_agents"."visibility" in ('private','public')),
	CONSTRAINT "custom_agents_moderation_status_check" CHECK ("custom_agents"."moderation_status" in ('none','pending_review','approved','rejected'))
);
--> statement-breakpoint
ALTER TABLE "agent_config" DROP CONSTRAINT "agent_config_org_id_unique";--> statement-breakpoint
ALTER TABLE "agent_config" DROP CONSTRAINT "agent_config_agent_type_check";--> statement-breakpoint
ALTER TABLE "membership" DROP CONSTRAINT "membership_role_check";--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "platform_role_check";--> statement-breakpoint
ALTER TABLE "app_connections" ALTER COLUMN "provider_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app_connections" ADD COLUMN "kind" text DEFAULT 'platform_rest' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_connections" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "app_connections" ADD COLUMN "transport" text;--> statement-breakpoint
ALTER TABLE "app_connections" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "connector_operations" ADD CONSTRAINT "connector_operations_connection_id_app_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."app_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_agents" ADD CONSTRAINT "custom_agents_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_agents" ADD CONSTRAINT "custom_agents_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_agents" ADD CONSTRAINT "custom_agents_connector_id_app_connections_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."app_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_agents" ADD CONSTRAINT "custom_agents_moderated_by_user_id_user_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connector_operations_connection_id_idx" ON "connector_operations" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "custom_agents_org_id_idx" ON "custom_agents" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "agent_config" ADD CONSTRAINT "agent_config_org_agent_type_unique" UNIQUE("org_id","agent_type");--> statement-breakpoint
ALTER TABLE "app_connections" ADD CONSTRAINT "app_connections_kind_check" CHECK ("app_connections"."kind" in ('platform_rest','custom_rest','mcp'));--> statement-breakpoint
ALTER TABLE "app_connections" ADD CONSTRAINT "app_connections_transport_check" CHECK ("app_connections"."transport" is null or "app_connections"."transport" in ('http','sse'));--> statement-breakpoint
ALTER TABLE "app_connections" ADD CONSTRAINT "app_connections_status_check" CHECK ("app_connections"."status" in ('pending_verification','active','error'));--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_role_check" CHECK ("membership"."role" in ('owner','operator','viewer'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "platform_role_check" CHECK ("user"."platform_role" is null or "user"."platform_role" in ('geifem_admin','platform_admin'));