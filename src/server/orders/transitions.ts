/**
 * Single order state machine (spec §4.5, §12.4). Owner: Payments & Orders.
 * The allowed graph is ORDER_TRANSITIONS in src/contracts/orders.ts (Architect); this file enforces it plus
 * WHO may cause each transition, and writes an order_events row for every change (spec §2).
 *
 * Hard rule (spec §4.6, §11): `paid` is reachable ONLY from a provider callback whose auth/signature was verified.
 */
import { ORDER_TRANSITIONS, type OrderStatus } from "@/contracts/orders";
import type { PaymentProviderName } from "../payments/types";
import type { CommerceRepo, OrderRow } from "../payments/store";

export type TransitionCause =
  | { kind: "provider_callback"; provider: PaymentProviderName; eventId: string; verified: true }
  | { kind: "admin"; actorId: string; note?: string }
  | { kind: "system"; reason: "reservation_expired" | "stock_conflict_refund" | "provider_cancel" | "cron" };

export class TransitionError extends Error {
  override name = "TransitionError";
  constructor(
    readonly code: "NOT_ALLOWED" | "FORBIDDEN_CAUSE" | "NOT_FOUND" | "CONFLICT",
    message: string,
  ) {
    super(message);
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Which causes may move an order INTO a status. */
function causeAllowed(to: OrderStatus, cause: TransitionCause): boolean {
  switch (to) {
    case "paid":
      // runtime check too: `verified` must literally be true, not just truthy-typed.
      return cause.kind === "provider_callback" && cause.verified === true;
    case "stock_conflict":
      return cause.kind === "provider_callback" || cause.kind === "system";
    case "refunded":
    case "partially_refunded":
      return true; // admin refund, provider cancel-after-perform, or automatic stock_conflict refund
    case "fulfilling":
    case "shipped":
    case "delivered":
      return cause.kind === "admin";
    case "cancelled":
      return cause.kind === "admin" || cause.kind === "system" || cause.kind === "provider_callback";
    case "pending_payment":
      return false; // initial state only
  }
}

export function assertTransition(from: OrderStatus, to: OrderStatus, cause: TransitionCause): void {
  if (!canTransition(from, to)) throw new TransitionError("NOT_ALLOWED", `order transition ${from} -> ${to} is not allowed`);
  if (!causeAllowed(to, cause)) throw new TransitionError("FORBIDDEN_CAUSE", `${cause.kind} may not move an order to ${to}`);
}

/**
 * Guard used BEFORE calling inventory.convert (which writes the order as `paid` inside the DB function):
 * the same "verified provider callback only" rule applies to the initial pending_payment -> paid step.
 */
export function assertPaymentCapture(cause: TransitionCause): void {
  assertTransition("pending_payment", "paid", cause);
}

export function eventTypeFor(to: OrderStatus): string {
  if (to === "paid") return "payment_received";
  if (to === "stock_conflict") return "stock_conflict";
  if (to === "refunded" || to === "partially_refunded") return "refund_succeeded";
  return "status_changed";
}

export interface TransitionResult {
  order: OrderRow;
  changed: boolean;
  from: OrderStatus;
}

/**
 * Move an order to `to`. Idempotent: if the order is already in `to`, returns changed=false and writes nothing
 * (provider retries). Uses compare-and-set, so two concurrent callers cannot both apply the same step.
 */
export async function transitionOrder(
  repo: CommerceRepo,
  orderId: string,
  to: OrderStatus,
  cause: TransitionCause,
  payload: Record<string, unknown> = {},
  now: Date = new Date(),
): Promise<TransitionResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const order = await repo.getOrder(orderId);
    if (!order) throw new TransitionError("NOT_FOUND", `order ${orderId} not found`);
    if (order.status === to) return { order, changed: false, from: order.status };
    assertTransition(order.status, to, cause);
    const ok = await repo.updateOrderStatus(
      orderId,
      {
        type: eventTypeFor(to),
        fromStatus: order.status,
        toStatus: to,
        payload: { ...payload, cause: describeCause(cause) },
        actorId: cause.kind === "admin" ? cause.actorId : null,
      },
      now,
    );
    if (ok) return { order: { ...order, status: to, paidAt: to === "paid" ? now : order.paidAt }, changed: true, from: order.status };
    // lost the race: re-read and re-evaluate
  }
  throw new TransitionError("CONFLICT", `order ${orderId} changed concurrently`);
}

function describeCause(cause: TransitionCause): Record<string, unknown> {
  switch (cause.kind) {
    case "provider_callback":
      return { kind: cause.kind, provider: cause.provider, eventId: cause.eventId };
    case "admin":
      return { kind: cause.kind, actorId: cause.actorId, note: cause.note ?? null };
    case "system":
      return { kind: cause.kind, reason: cause.reason };
  }
}
