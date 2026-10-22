/**
 * Checkout idempotency: idempotencyKey (contracts: z.uuid()) is bound to an HMAC of the canonical
 * request payload (key excluded). Same key + same payload -> replay; same key + different payload -> 409.
 * Only the hash is stored (checkouts.idempotency_request_hash); no token is part of it.
 */
import { createHmac } from "node:crypto";
import type { CreateCheckoutRequest } from "@/contracts/checkout";

/** Recursively sorted keys; undefined dropped; items sorted by variantId (bag order is not meaningful). */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, canonical(x)]));
  }
  return v;
}

export function requestHash(secret: string, req: CreateCheckoutRequest): string {
  const { idempotencyKey: _k, ...rest } = req;
  void _k;
  const items = [...rest.items].sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : a.quantity - b.quantity));
  return createHmac("sha256", secret).update(`checkout-request:${JSON.stringify(canonical({ ...rest, items }))}`).digest("hex");
}

/** 409 IDEMPOTENCY_CONFLICT. Not in contracts ERROR_CODES yet (Architect), so it is a distinct error the route maps. */
export class IdempotencyConflictError extends Error {
  override name = "IdempotencyConflictError";
  readonly code = "IDEMPOTENCY_CONFLICT";
  readonly status = 409;
  constructor() { super("idempotencyKey was already used with a different request"); }
}
