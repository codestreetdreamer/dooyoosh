/**
 * Cart-to-checkout (spec §4.1, §5, §11, §12, CONTRACTS createCheckout / checkoutStatus). Owner: Payments & Orders.
 *
 * Flow: validate lines (QA-07) -> load variants + shipping from DB -> recompute prices/shipping/totals (client prices
 * ignored) -> ONE transaction { insert checkouts row; inventory.reserve (reserve_checkout) } -> provider.createSession
 * -> store provider_session_id. Provider session = 30 min, reservation = 35 min (contracts/checkout.ts).
 */
import { randomUUID } from "node:crypto";
import { PROVIDER_SESSION_TTL_MINUTES, RESERVATION_TTL_MINUTES, type CreateCheckoutRequest, type CreateCheckoutResponse } from "@/contracts/checkout";
import type { CheckoutStatusResponse } from "@/contracts/orders";
import { ApiError } from "@/lib/errors";
import type { PaymentProvider } from "../payments/types";
import type { PaymentDeps } from "../payments/deps";
import type { CheckoutRow, NewCheckout } from "../payments/store";
import { computeQuote, linesMissingFiscalData, validateLines } from "./pricing";
import { deriveAccessToken, hashAccessToken, tokenMatches } from "./token";

/**
 * + accessToken: the raw guest token (QA P1). It is returned ONLY in this 201 body and is never put in any URL
 * (redirect, success/return, cancel) because those reach third-party hosts (Payme/Click return_url) and logs.
 * Frontend keeps it (sessionStorage by checkoutId) and sends it in the body of /sandbox-pay and as ?token= on
 * GET /checkout/{id}/status and /orders/{ref} (our own API, no-store, no-referrer).
 * PROPOSAL to Architect: add `accessToken` to contracts createCheckoutResponse.data.
 */
type CheckoutData = CreateCheckoutResponse["data"] & { accessToken: string };
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

function toData(c: NewCheckout | CheckoutRow, provider: PaymentProvider, redirectUrl: string, tokenSecret: string): CheckoutData {
  return {
    accessToken: deriveAccessToken(tokenSecret, c.id),
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

  // Idempotent retry of the same submit (contracts: idempotencyKey). Same key -> same checkout, no second reservation.
  if (req.idempotencyKey) {
    const existing = await repo.getCheckoutByIdempotencyKey(req.idempotencyKey);
    if (existing) {
      if ((existing.status === "open" || existing.status === "awaiting_payment") && existing.expiresAt > now && existing.provider === provider.name) {
        const s = await openSession(deps, provider, existing);
        return toData(existing, provider, s.redirectUrl, deps.config.tokenSecret);
      }
      throw ApiError.validation("idempotencyKey was already used for a closed checkout; start a new checkout");
    }
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
    accessTokenHash: hashAccessToken(deps.config.tokenSecret, deriveAccessToken(deps.config.tokenSecret, id)),
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
  await repo.runInTransaction(async (tx) => {
    await repo.insertCheckout(c, tx);
    const r = await inventory.reserve(id, quote.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), c.reservedUntil, tx);
    if (!r.ok) throw r.code === "PRICE_CHANGED" ? ApiError.priceChanged(r.variantIds) : ApiError.outOfStock(r.variantIds);
  });

  let session;
  try {
    session = await openSession(deps, provider, c);
  } catch (e) {
    await inventory.release(id, "canceled");
    await repo.setCheckoutStatus(id, "failed");
    throw ApiError.payment("Could not start payment", { provider: provider.name, cause: e instanceof Error ? e.message : "unknown" });
  }
  await repo.setProviderSession(id, session.providerSessionId);
  return toData(c, provider, session.redirectUrl, deps.config.tokenSecret);
}

/** GET /checkout/{id}/status?token= — unknown id OR wrong token -> 404 (do not reveal which). */
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
