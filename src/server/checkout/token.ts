/**
 * Guest access token for status / order / sandbox endpoints (contracts createCheckoutResponse.data.accessToken).
 * Architect ruling (main 12599c0): token is DERIVED, never stored:
 *   accessToken = base64url(HMAC_SHA256(ORDER_TOKEN_SECRET, "checkout:" + checkoutId + ":" + idempotencyKey))
 * (idempotencyKey = "" when the client sent none). The store keeps only hex(HMAC_SHA256(ORDER_TOKEN_SECRET, token))
 * (checkouts.access_token_hash -> orders.access_token_hash). A replay with the same key + payload recomputes it.
 * Clients send it as `Authorization: Bearer <token>` (status, orders) or in the sandbox-pay JSON body; never in a URL.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function deriveAccessToken(secret: string, checkoutId: string, idempotencyKey: string | null): string {
  return createHmac("sha256", secret).update(`checkout:${checkoutId}:${idempotencyKey ?? ""}`).digest("base64url");
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
