ALTER TABLE "membership" DROP CONSTRAINT "membership_role_check";--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "platform_role_check";--> statement-breakpoint
-- Contracción del rename 'geifem_admin' -> 'platform_admin' (el paso expand ya está aplicado,
-- ver migración 0007) — migra las filas existentes antes de reinstalar el CHECK más estricto.
UPDATE "user" SET "platform_role" = 'platform_admin' WHERE "platform_role" = 'geifem_admin';--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_role_check" CHECK ("membership"."role" in ('owner','operator'));--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_status_check" CHECK ("organization"."status" in ('active','blocked'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "platform_role_check" CHECK ("user"."platform_role" is null or "user"."platform_role" = 'platform_admin');