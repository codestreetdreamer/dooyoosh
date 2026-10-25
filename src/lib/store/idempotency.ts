/**
 * Checkout idempotency keys (contract: createCheckoutRequest.idempotencyKey, uuid).
 * - 128-bit random UUID v4 per checkout ATTEMPT (crypto.randomUUID, or getRandomValues fallback).
 * - Reused only while the payload is identical (retries of the same submit -> same checkout + same accessToken).
 * - Any change to bag, address, contact or delivery method => new key (server 409s same key + different payload).
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Stable fingerprint of everything that defines the checkout payload (except the key itself). */
export function payloadFingerprint(payload: unknown): string {
  const norm = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(norm)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)]))
    : v;
  return JSON.stringify(norm(payload));
}

export class IdempotencyKeeper {
  private key: string | null = null;
  private fp: string | null = null;
  /** Key for this payload: same payload -> same key; changed payload -> fresh key. */
  keyFor(payload: unknown): string {
    const fp = payloadFingerprint(payload);
    if (!this.key || fp !== this.fp) {
      this.key = newIdempotencyKey();
      this.fp = fp;
    }
    return this.key;
  }
  /** Force a fresh key on the next call (e.g. after 409 key/payload mismatch or a stock/price conflict). */
  reset() {
    this.key = null;
    this.fp = null;
  }
}
