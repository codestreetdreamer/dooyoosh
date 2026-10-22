/** Read models for GET /orders/{reference} (guest) and admin order views. Owner: Payments & Orders. */
import type { PublicOrder } from "@/contracts/orders";
import type { AdminOrder } from "@/contracts/admin";
import type { PaymentDeps } from "../payments/deps";
import type { OrderDetail, ShipmentRow } from "../payments/store";
import { tokenMatches } from "../checkout/token";
import { ApiError } from "@/lib/errors";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const totalsOf = (o: OrderDetail) => ({ currency: o.currency, subtotalMinor: o.subtotalMinor, shippingMinor: o.shippingMinor, taxMinor: o.taxMinor, discountMinor: o.discountMinor, totalMinor: o.totalMinor });
const shipmentOf = (s: ShipmentRow) => ({ id: s.id, carrier: s.carrier, trackingNumber: s.trackingNumber, trackingUrl: s.trackingUrl, status: s.status, shippedAt: iso(s.shippedAt), deliveredAt: iso(s.deliveredAt) });
const itemOf = (l: OrderDetail["items"][number]) => ({ sku: l.sku, productName: l.productName, size: l.size, colour: l.colour, unitPriceMinor: l.unitPriceMinor, quantity: l.quantity, lineTotalMinor: l.lineTotalMinor });

export function toPublicOrder(o: OrderDetail): PublicOrder {
  return {
    reference: o.reference, status: o.status, email: o.email, locale: o.locale as PublicOrder["locale"], currency: o.currency, totals: totalsOf(o),
    items: o.items.map(itemOf), shippingAddress: o.shippingAddress, shipments: o.shipments.map(shipmentOf), placedAt: o.placedAt.toISOString(), paidAt: iso(o.paidAt),
  };
}

export function toAdminOrder(o: OrderDetail): AdminOrder {
  return {
    id: o.id, reference: o.reference, checkoutId: o.checkoutId, email: o.email, phone: o.phone, locale: o.locale as AdminOrder["locale"], status: o.status, totals: totalsOf(o),
    items: o.items.map((l) => ({ ...itemOf(l), variantId: l.variantId })), shippingAddress: o.shippingAddress, billingAddress: o.billingAddress, shippingMethodId: o.shippingMethodId,
    payments: o.payments.map((p) => ({ id: p.id, provider: p.provider, providerPaymentId: p.providerPaymentId, amountMinor: p.amountMinor, currency: p.currency, status: p.status, createdAt: p.createdAt.toISOString() })),
    refunds: o.refunds.map((r) => ({ id: r.id, paymentId: r.paymentId, amountMinor: r.amountMinor, reason: r.reason, providerRefundId: r.providerRefundId, status: r.status, createdAt: r.createdAt.toISOString() })),
    shipments: o.shipments.map(shipmentOf),
    events: o.events.map((e) => ({ id: e.id, type: e.type, fromStatus: e.fromStatus, toStatus: e.toStatus, payload: e.payload, actorId: e.actorId, createdAt: e.createdAt.toISOString() })),
    placedAt: o.placedAt.toISOString(), paidAt: iso(o.paidAt), updatedAt: o.updatedAt.toISOString(),
  };
}

/**
 * Guest order page. Unknown reference and wrong token both -> 404 (contract: do not reveal which).
 * The token is compared as sha256 digests with timingSafeEqual (checkout/token.ts). A dummy compare runs for unknown
 * references so both 404 paths do the same hashing work.
 */
const DUMMY_HASH = "0".repeat(64);
export async function getPublicOrder(deps: PaymentDeps, reference: string, token: string): Promise<PublicOrder> {
  const id = await deps.repo.getOrderIdByReference(reference);
  const o = id ? await deps.repo.getOrderDetail(id) : null;
  const ok = tokenMatches(token, o?.accessTokenHash ?? DUMMY_HASH);
  if (!o || !ok) throw ApiError.notFound();
  return toPublicOrder(o);
}
