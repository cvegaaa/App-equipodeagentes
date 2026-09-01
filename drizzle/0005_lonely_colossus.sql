ALTER TABLE "organization" ADD COLUMN "whatsapp_number" text;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_whatsapp_number_unique" UNIQUE("whatsapp_number");