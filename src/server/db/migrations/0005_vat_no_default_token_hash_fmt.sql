-- 0005 (Backend & Database), LOCAL ONLY until QA green. Architect/Payments decisions 2026-10-22:
-- 1) products.vat_rate_bp: NO default (NOT NULL, 0..10000) — writers set VAT explicitly (seeds write 1200).
-- 2) access_token_hash = lower-case hex HMAC_SHA256(ORDER_TOKEN_SECRET, token), computed by Payments; DB enforces the format only.
-- 3) provider_transactions.seq (identity, monotonic => per provider too; Payme GetStatement order) + provider_time (provider ms, nullable).
-- 4) refunds.idempotency_key: text (was uuid), NOT NULL UNIQUE, 1..200 chars.
-- 5) checkouts.idempotency_payload_hash (hex sha256 of the createCheckout payload, by Payments); required when idempotency_key is set.
ALTER TABLE "products" ALTER COLUMN "vat_rate_bp" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "idempotency_key" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "checkouts" ADD COLUMN "idempotency_payload_hash" text;--> statement-breakpoint
ALTER TABLE "provider_transactions" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "provider_transactions_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "provider_transactions" ADD COLUMN "provider_time" bigint;--> statement-breakpoint
CREATE INDEX "provider_transactions_provider_time_idx" ON "provider_transactions" USING btree ("provider","provider_time");--> statement-breakpoint
ALTER TABLE "provider_transactions" ADD CONSTRAINT "provider_transactions_provider_seq_uq" UNIQUE("provider","seq");--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_idempotency_payload_hash_fmt" CHECK ("checkouts"."idempotency_payload_hash" IS NULL OR "checkouts"."idempotency_payload_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_idempotency_key_has_hash" CHECK ("checkouts"."idempotency_key" IS NULL OR "checkouts"."idempotency_payload_hash" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_access_token_hash_fmt" CHECK ("checkouts"."access_token_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_access_token_hash_fmt" CHECK ("orders"."access_token_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "provider_transactions" ADD CONSTRAINT "provider_transactions_provider_time_pos" CHECK ("provider_transactions"."provider_time" IS NULL OR "provider_transactions"."provider_time" > 0);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_idempotency_key_len" CHECK (length("refunds"."idempotency_key") BETWEEN 1 AND 200);