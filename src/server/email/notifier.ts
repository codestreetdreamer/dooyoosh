/**
 * Order notification hook (Resend + React Email later; spec §1). Owner: Payments & Orders.
 * Payment code calls these after state changes; the default implementation only logs (no network in sandbox/tests).
 */
export interface OrderNotifier {
  orderPaid(e: { orderId: string; reference: string; checkoutId: string }): Promise<void>;
  /** late payment after reservation released: customer apology + refund notice (spec §11) */
  stockConflict(e: { orderId: string; reference: string; refund: "succeeded" | "manual_required" }): Promise<void>;
  orderRefunded(e: { orderId: string; reference: string; amountMinor: number; currency: string }): Promise<void>;
  /** staff alert: provider has no refund API, refund must be done in the provider cabinet */
  manualRefundRequired(e: { orderId: string; reference: string; provider: string; instructions: string }): Promise<void>;
}

export const logNotifier: OrderNotifier = {
  async orderPaid(e) { console.info("[notify] order paid", e.reference); },
  async stockConflict(e) { console.warn("[notify] stock conflict", e.reference, e.refund); },
  async orderRefunded(e) { console.info("[notify] order refunded", e.reference); },
  async manualRefundRequired(e) { console.error("[notify] MANUAL REFUND REQUIRED", e.reference, e.provider, e.instructions); },
};
