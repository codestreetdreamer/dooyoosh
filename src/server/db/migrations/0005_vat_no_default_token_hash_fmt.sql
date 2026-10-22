-- 0005 (Backend & Database): Architect decisions 2026-10-22.
-- 1) products.vat_rate_bp has NO default (stays NOT NULL, 0..10000): writers must set VAT explicitly (seeds write 1200).
-- 2) access_token_hash = lower-case hex HMAC_SHA256(ORDER_TOKEN_SECRET, token), computed by Payments; DB enforces the format only.
ALTER TABLE "products" ALTER COLUMN "vat_rate_bp" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_access_token_hash_fmt" CHECK ("checkouts"."access_token_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_access_token_hash_fmt" CHECK ("orders"."access_token_hash" ~ '^[0-9a-f]{64}$');