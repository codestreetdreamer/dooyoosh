/**
 * Guest access token for the success page / order page (contracts: checkoutStatusQuery.token, getOrderQuery.token).
 * token = base64url(HMAC-SHA256(ORDER_TOKEN_SECRET, "checkout:" + checkoutId)). Deterministic, so an idempotent
 * checkout retry can return the same success URL without storing the raw token. DB stores only hex(HMAC_SHA256(ORDER_TOKEN_SECRET, token))
 * (checkouts.access_token_hash, copied to orders.access_token_hash by convert_checkout_to_order — SCHEMA_DELTA B1).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function deriveAccessToken(secret: string, checkoutId: string): string {
  return createHmac("sha256", secret).update(`checkout:${checkoutId}`).digest("base64url");
}

/** access_token_hash = hex(HMAC_SHA256(ORDER_TOKEN_SECRET, token)) (Architect, main cf91ef3). A DB leak alone cannot be
 *  brute-forced into tokens without the secret. */
export function hashAccessToken(secret: string, token: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

/** Constant-time: fixed-length HMAC digests compared with timingSafeEqual; malformed stored hashes never match. */
export function tokenMatches(secret: string, token: string, storedHash: string): boolean {
  const a = Buffer.from(hashAccessToken(secret, token), "hex");
  const b = /^[0-9a-f]{64}$/.test(storedHash) ? Buffer.from(storedHash, "hex") : Buffer.alloc(32);
  return timingSafeEqual(a, b) && b.length === 32 && storedHash.length === 64;
}
