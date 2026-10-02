ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" uuid;--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
UPDATE "refresh_tokens" SET "family_id" = "id" WHERE "family_id" IS NULL;
