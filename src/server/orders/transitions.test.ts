import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, ORDER_TRANSITIONS } from "@/contracts/orders";
import { assertPaymentCapture, assertTransition, canTransition, transitionOrder, TransitionError, type TransitionCause } from "./transitions";
import { MemoryStore } from "../payments/memory-store";

const verified: TransitionCause = { kind: "provider_callback", provider: "payme", eventId: "e1", verified: true };
const admin: TransitionCause = { kind: "admin", actorId: "11111111-1111-4111-8111-111111111111" };
const system: TransitionCause = { kind: "system", reason: "cron" };

function storeWithOrder(status: (typeof ORDER_STATUSES)[number]) {
  const s = new MemoryStore();
  s.s.orders.set("o1", { id: "o1", reference: "DY-20261022-ABCDE", checkoutId: "c1", status, totalMinor: 100, currency: "UZS", items: [], paidAt: null });
  return s;
}

describe("order state machine", () => {
  it("allows exactly the contract graph", () => {
    for (const from of ORDER_STATUSES) for (const to of ORDER_STATUSES) expect(canTransition(from, to)).toBe(ORDER_TRANSITIONS[from].includes(to));
    expect(canTransition("refunded", "paid")).toBe(false);
    expect(canTransition("stock_conflict", "paid")).toBe(false);
    expect(canTransition("shipped", "pending_payment")).toBe(false);
  });

  it("paid only via a verified provider callback", () => {
    expect(() => assertPaymentCapture(verified)).not.toThrow();
    expect(() => assertPaymentCapture(admin)).toThrow(TransitionError);
    expect(() => assertPaymentCapture(system)).toThrow(TransitionError);
    // forged object with verified=false must not pass at runtime either
    expect(() => assertPaymentCapture({ ...verified, verified: false } as unknown as TransitionCause)).toThrow(/may not move/);
  });

  it("fulfilment statuses only by admin; stock_conflict not by admin", () => {
    expect(() => assertTransition("paid", "fulfilling", verified)).toThrow();
    expect(() => assertTransition("paid", "fulfilling", admin)).not.toThrow();
    expect(() => assertTransition("pending_payment", "stock_conflict", admin)).toThrow();
    expect(() => assertTransition("pending_payment", "stock_conflict", system)).not.toThrow();
  });

  it("writes one order_events row per change and is idempotent on repeat", async () => {
    const s = storeWithOrder("paid");
    const r1 = await transitionOrder(s, "o1", "fulfilling", admin, { note: "packing" });
    expect(r1.changed).toBe(true);
    const r2 = await transitionOrder(s, "o1", "fulfilling", admin);
    expect(r2.changed).toBe(false);
    expect(s.s.orderEvents).toHaveLength(1);
    expect(s.s.orderEvents[0]).toMatchObject({ orderId: "o1", fromStatus: "paid", toStatus: "fulfilling", type: "status_changed", actorId: admin.kind === "admin" ? admin.actorId : null });
  });

  it("rejects disallowed transitions without writing events", async () => {
    const s = storeWithOrder("delivered");
    await expect(transitionOrder(s, "o1", "paid", verified)).rejects.toThrow(/not allowed/);
    expect(s.s.orderEvents).toHaveLength(0);
    expect(s.s.orders.get("o1")!.status).toBe("delivered");
  });

  it("stock_conflict -> refunded is allowed for the automatic refund", async () => {
    const s = storeWithOrder("stock_conflict");
    const r = await transitionOrder(s, "o1", "refunded", { kind: "system", reason: "stock_conflict_refund" });
    expect(r.changed).toBe(true);
  });
});
