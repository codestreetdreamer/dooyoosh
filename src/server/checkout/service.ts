/**
 * Cart-to-checkout (spec §4.1, §5, §11, §12, CONTRACTS createCheckout / checkoutStatus). Owner: Payments & Orders.
 *
 * Flow: validate lines (QA-07) -> load variants + shipping from DB -> recompute prices/shipping/totals (client prices
 * ignored) -> ONE transaction { insert checkouts row; inventory.reserve (reserve_checkout) } -> provider.createSession
 * -> store provider_session_id. Provider session = 30 min, reservation = 35 min (contracts/checkout.ts).
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import { PROVIDER_SESSION_TTL_MINUTES, RESERVATION_TTL_MINUTES, type CreateCheckoutRequest, type CreateCheckoutResponse } from "@/contracts/checkout";
import type { CheckoutStatusResponse } from "@/contracts/orders";
import { ApiError } from "@/lib/errors";
import type { PaymentProvider } from "../payments/types";
import type { PaymentDeps } from "../payments/deps";
import type { CheckoutRow, NewCheckout } from "../payments/store";
import { computeQuote, linesMissingFiscalData, validateLines } from "./pricing";
import { deriveAccessToken, hashAccessToken, tokenMatches } from "./token";
import { IdempotencyConflictError, requestHash } from "./idempotency";

/**
 * accessToken: the guest token, derived (token.ts), never stored (only its HMAC hash), never in any URL (redirect,
 * success/return, cancel reach Payme/Click and logs). An idempotent replay (same key + same payload) recomputes and
 * returns the same accessToken with replayed = true (route answers 200 instead of 201).
 */
export type CheckoutData = CreateCheckoutResponse["data"] & { replayed: boolean };
const MIN = 60_000;

function urls(deps: PaymentDeps, c: { id: string; locale: string }) {
  // Frontend contract: return page polls GET /checkout/{id}/status; the URL itself is never proof of payment.
  // checkoutId only, never the token (QA P1): successUrl is handed to Payme/Click as return_url.
  const success = new URL(`/${c.locale}/checkout/return`, deps.config.siteUrl);
  success.searchParams.set("checkoutId", c.id);
  const cancel = new URL(`/${c.locale}/bag`, deps.config.siteUrl);
  return { successUrl: success.toString(), cancelUrl: cancel.toString() };
}

async function openSession(deps: PaymentDeps, provider: PaymentProvider, c: NewCheckout | CheckoutRow) {
  const { successUrl, cancelUrl } = urls(deps, c);
  return provider.createSession({
    checkoutId: c.id,
    email: c.email,
    locale: c.locale as CreateCheckoutRequest["locale"],
    lines: c.items,
    totals: { currency: c.currency, subtotalMinor: c.subtotalMinor, shippingMinor: c.shippingMinor, taxMinor: c.taxMinor, discountMinor: c.discountMinor, totalMinor: c.totalMinor },
    successUrl,
    cancelUrl,
    expiresAt: c.expiresAt,
    idempotencyKey: c.id,
  });
}

function toData(c: NewCheckout | CheckoutRow, provider: PaymentProvider, redirectUrl: string, tokenSecret: string, replayed: boolean): CheckoutData {
  return {
    accessToken: deriveAccessToken(tokenSecret, c.id, c.idempotencyKey),
    replayed,
    checkoutId: c.id,
    provider: provider.name,
    redirectUrl,
    expiresAt: c.expiresAt.toISOString(),
    reservedUntil: c.reservedUntil.toISOString(),
    totals: { currency: c.currency, subtotalMinor: c.subtotalMinor, shippingMinor: c.shippingMinor, taxMinor: c.taxMinor, discountMinor: c.discountMinor, totalMinor: c.totalMinor },
  };
}

export async function createCheckout(deps: PaymentDeps, provider: PaymentProvider, req: CreateCheckoutRequest): Promise<CheckoutData> {
  const { repo, inventory } = deps;
  const now = deps.now();
  validateLines(req.items);

  // Idempotent retry (contracts: idempotencyKey). Key bound to the payload hash; same key -> same checkout, no second reservation.
  const reqHash = req.idempotencyKey ? requestHash(deps.config.tokenSecret, req) : null;
  if (req.idempotencyKey) {
    const existing = await repo.getCheckoutByIdempotencyKey(req.idempotencyKey);
    if (existing) return replay(deps, provider, existing, reqHash!);
  }

  const variants = await repo.getVariantsForCheckout(req.items.map((i) => i.variantId), req.locale);
  const shipping = await repo.getShippingMethod(req.shippingMethodId, req.shippingAddress.country);
  const quote = computeQuote(req.items, variants, shipping, req.shippingAddress.country);

  const cur = quote.totals.currency;
  if (provider.supportedCurrencies !== "any" && !provider.supportedCurrencies.includes(cur)) {
    throw ApiError.payment(`${provider.name} cannot charge ${cur}`, { currency: cur });
  }
  if (provider.mode === "live") {
    const missing = linesMissingFiscalData(quote.lines);
    if (missing.length) throw ApiError.payment("Some products are missing fiscal data (IKPU/package code/VAT)", { variantIds: missing });
  }

  const id = randomUUID();
  const c: NewCheckout = {
    id,
    idempotencyKey: req.idempotencyKey ?? null,
    idempotencyRequestHash: reqHash,
    accessTokenHash: hashAccessToken(deps.config.tokenSecret, deriveAccessToken(deps.config.tokenSecret, id, req.idempotencyKey ?? null)),
    email: req.email,
    phone: req.phone ?? req.shippingAddress.phone ?? null,
    locale: req.locale,
    currency: cur,
    items: quote.lines,
    shippingAddress: req.shippingAddress,
    billingAddress: req.billingAddress ?? null,
    shippingMethodId: req.shippingMethodId,
    shippingName: shipping?.name ?? "Delivery",
    subtotalMinor: quote.totals.subtotalMinor,
    shippingMinor: quote.totals.shippingMinor,
    taxMinor: quote.totals.taxMinor,
    discountMinor: quote.totals.discountMinor,
    totalMinor: quote.totals.totalMinor,
    provider: provider.name,
    expiresAt: new Date(now.getTime() + PROVIDER_SESSION_TTL_MINUTES * MIN),
    reservedUntil: new Date(now.getTime() + RESERVATION_TTL_MINUTES * MIN),
  };

  // ONE transaction: checkout row + reservations. reserve_checkout is the authoritative stock check.
  try {
    await repo.runInTransaction(async (tx) => {
      await repo.insertCheckout(c, tx);
      const r = await inventory.reserve(id, quote.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), c.reservedUntil, tx);
      if (!r.ok) throw r.code === "PRICE_CHANGED" ? ApiError.priceChanged(r.variantIds) : ApiError.outOfStock(r.variantIds);
    });
  } catch (e) {
    // concurrent submit with the same key won the UNIQUE(idempotency_key) race: answer as a replay of the winner
    if (req.idempotencyKey && isUniqueViolation(e)) {
      const winner = await repo.getCheckoutByIdempotencyKey(req.idempotencyKey);
      if (winner) return replay(deps, provider, winner, reqHash!);
    }
    throw e;
  }

  let session;
  try {
    session = await openSession(deps, provider, c);
  } catch (e) {
    await inventory.release(id, "canceled");
    await repo.setCheckoutStatus(id, "failed");
    throw ApiError.payment("Could not start payment", { provider: provider.name, cause: e instanceof Error ? e.message : "unknown" });
  }
  await repo.setProviderSession(id, session.providerSessionId);
  return toData(c, provider, session.redirectUrl, deps.config.tokenSecret, false);
}

function isUniqueViolation(e: unknown): boolean {
  const o = e as { code?: unknown; message?: unknown } | null;
  return !!o && (o.code === "23505" || (typeof o.message === "string" && o.message.includes("unique violation: idempotency_key")));
}

async function replay(deps: PaymentDeps, provider: PaymentProvider, existing: CheckoutRow, reqHash: string): Promise<CheckoutData> {
  const h = existing.idempotencyRequestHash;
  if (!h || h.length !== reqHash.length || !timingSafeEqual(Buffer.from(h), Buffer.from(reqHash))) throw new IdempotencyConflictError();
  if ((existing.status === "open" || existing.status === "awaiting_payment") && existing.expiresAt > deps.now() && existing.provider === provider.name) {
    const s = await openSession(deps, provider, existing);
    return toData(existing, provider, s.redirectUrl, deps.config.tokenSecret, true);
  }
  throw ApiError.validation("idempotencyKey was already used for a closed checkout; start a new checkout");
}

/** GET /checkout/{id}/status (Authorization: Bearer) — unknown id OR wrong token -> 404 (do not reveal which). */
export async function getCheckoutStatus(deps: PaymentDeps, checkoutId: string, token: string): Promise<CheckoutStatusResponse["data"]> {
  const c = await deps.repo.getCheckout(checkoutId);
  if (!c || !tokenMatches(deps.config.tokenSecret, token, c.accessTokenHash)) throw ApiError.notFound();
  const order = await deps.repo.getOrderByCheckout(checkoutId);
  return { checkoutStatus: c.status, orderReference: order?.reference ?? null, orderStatus: order?.status ?? null };
}

/** POST /cron/release-expired: cancel provider session, then release stock (contracts/inventory.ts note). */
export async function releaseExpiredCheckouts(deps: PaymentDeps, provider: PaymentProvider, limit = 200) {
  const now = deps.now();
  let checkoutsExpired = 0;
  let reservationsReleased = 0;
  for (const c of await deps.repo.listExpiredCheckouts(now, limit)) {
    if (await deps.repo.getOrderByCheckout(c.id)) continue;
    if (c.providerSessionId && c.provider === provider.name) await provider.cancel(c.providerSessionId);
    reservationsReleased += await deps.inventory.release(c.id, "expired");
    await deps.repo.setCheckoutStatus(c.id, "expired");
    checkoutsExpired++;
  }
  reservationsReleased += await deps.inventory.releaseExpired(now);
  return { checkoutsExpired, reservationsReleased };
}
