ALTER TABLE "runs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE INDEX "runs_org_idempotency_idx" ON "runs" USING btree ("org_id","idempotency_key");