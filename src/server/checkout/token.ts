/**
 * Guest access token for the success page / order page (contracts: checkoutStatusQuery.token, getOrderQuery.token).
 * token = base64url(HMAC-SHA256(ORDER_TOKEN_SECRET, "checkout:" + checkoutId)). Deterministic, so an idempotent
 * checkout retry can return the same success URL without storing the raw token. DB stores only sha256(token)
 * (checkouts.access_token_hash, copied to orders.access_token_hash by convert_checkout_to_order — SCHEMA_DELTA B1).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function deriveAccessToken(secret: string, checkoutId: string): string {
  return createHmac("sha256", secret).update(`checkout:${checkoutId}`).digest("base64url");
}

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashAccessToken(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
