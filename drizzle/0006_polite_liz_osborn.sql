ALTER TABLE "organization" ADD COLUMN "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_telegram_chat_id_unique" UNIQUE("telegram_chat_id");