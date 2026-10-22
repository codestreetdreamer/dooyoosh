/**
 * In-memory CommerceRepo + InventoryService fake. TESTS AND LOCAL DEMO ONLY (refused in production by container.ts).
 * Mirrors the semantics required of Backend's SQL functions (contracts/inventory.ts, SCHEMA_DELTA A8, QA-06/07):
 *  - reserve: all-or-nothing, rejects qty < 1, only active variants, on_hand - reserved >= q
 *  - convert: idempotent per checkout; checks THIS checkout's reservations are 'active' and unexpired (never just the
 *    variant counters, QA-06); otherwise releases leftovers and records the order as stock_conflict
 *  - adjust: append-only movement ledger
 */
import { randomUUID } from "node:crypto";
import type { OrderStatus } from "@/contracts/orders";
import type { CheckoutStatus } from "@/contracts/checkout";
import type { AdjustStockInput, ConvertOrderInput, ConvertResult, InventoryService, ReleaseReason, ReserveLine, ReserveResult, TxLike } from "./types";
import type { PaymentProviderName } from "./types";
import type { CheckoutRow, CommerceRepo, NewCheckout, OrderEventInput, OrderRow, ProviderTxn, ShippingMethodForCheckout, VariantForCheckout } from "./store";

interface VariantState extends VariantForCheckout { stockOnHand: number; stockReserved: number }
interface Reservation { id: string; variantId: string; checkoutId: string; quantity: number; expiresAt: Date; status: "active" | "converted" | "released" }

export interface MemoryState {
  variants: Map<string, VariantState>;
  shipping: Map<string, ShippingMethodForCheckout & { countries: string[] }>;
  checkouts: Map<string, CheckoutRow>;
  reservations: Reservation[];
  orders: Map<string, OrderRow>;
  orderEvents: (OrderEventInput & { orderId: string; at: Date })[];
  movements: { variantId: string; delta: number; reason: string; orderId: string | null; note: string | null; actorId: string | null }[];
  paymentEvents: Map<string, { type: string; processed: boolean; error: string | null }>;
  payments: Map<string, { orderId: string; provider: string; providerPaymentId: string; amountMinor: number; currency: string; status: string }>;
  refunds: Map<string, { orderId: string; amountMinor: number; status: string; providerRefundId: string | null }>;
  providerTxns: Map<string, ProviderTxn>;
  seq: number;
}

function emptyState(): MemoryState {
  return { variants: new Map(), shipping: new Map(), checkouts: new Map(), reservations: [], orders: new Map(), orderEvents: [], movements: [], paymentEvents: new Map(), payments: new Map(), refunds: new Map(), providerTxns: new Map(), seq: 0 };
}

export class MemoryStore implements CommerceRepo, InventoryService {
  s: MemoryState = emptyState();
  constructor(private readonly clock: () => Date = () => new Date()) {}

  // ---------- seeding helpers (tests / demo)
  addVariant(v: Partial<VariantForCheckout> & { variantId: string; unitPriceMinor: number; currency: string; stockOnHand: number }) {
    this.s.variants.set(v.variantId, {
      sku: `DEMO-${v.variantId.slice(0, 4)}`, productName: "Demo product", size: null, colour: null, isActive: true, isPublished: true, weightGrams: 500,
      ikpuCode: null, packageCode: null, vatRateBp: null, available: 0, stockReserved: 0, ...v,
    } as VariantState);
  }
  addShippingMethod(m: Omit<ShippingMethodForCheckout, "countryShippable"> & { countries: string[] }) {
    this.s.shipping.set(m.methodId, { ...m, countryShippable: true });
  }
  stock(variantId: string) {
    const v = this.s.variants.get(variantId)!;
    return { onHand: v.stockOnHand, reserved: v.stockReserved };
  }

  // ---------- CommerceRepo
  private txChain: Promise<unknown> = Promise.resolve();
  /** Serialized (one at a time, like row locks) so a rollback snapshot never clobbers a concurrent transaction. */
  async runInTransaction<T>(fn: (tx: TxLike) => Promise<T>): Promise<T> {
    const run = async () => {
      const snapshot = structuredClone(this.s);
      try {
        return await fn({ memoryTx: true });
      } catch (e) {
        this.s = snapshot;
        throw e;
      }
    };
    const p = this.txChain.then(run, run);
    this.txChain = p.catch(() => undefined);
    return p;
  }
  async getVariantsForCheckout(ids: string[]) {
    return ids.flatMap((id) => {
      const v = this.s.variants.get(id);
      return v ? [{ ...v, available: v.stockOnHand - v.stockReserved }] : [];
    });
  }
  async getShippingMethod(methodId: string, country: string) {
    const m = this.s.shipping.get(methodId);
    if (!m) return null;
    const { countries, ...rest } = m;
    return { ...rest, countryShippable: countries.includes(country) };
  }
  async insertCheckout(c: NewCheckout) {
    if (c.idempotencyKey && [...this.s.checkouts.values()].some((x) => x.idempotencyKey === c.idempotencyKey)) throw new Error("unique violation: idempotency_key");
    this.s.checkouts.set(c.id, { ...c, status: "open", providerSessionId: null, createdAt: this.clock() });
  }
  async getCheckout(id: string) { return this.s.checkouts.get(id) ?? null; }
  async getCheckoutByIdempotencyKey(key: string) { return [...this.s.checkouts.values()].find((c) => c.idempotencyKey === key) ?? null; }
  async setProviderSession(id: string, sessionId: string) {
    const c = this.s.checkouts.get(id)!;
    c.providerSessionId = sessionId;
    if (c.status === "open") c.status = "awaiting_payment";
  }
  async setCheckoutStatus(id: string, status: CheckoutStatus) { const c = this.s.checkouts.get(id); if (c) c.status = status; }
  async listExpiredCheckouts(now: Date, limit: number) {
    return [...this.s.checkouts.values()].filter((c) => (c.status === "open" || c.status === "awaiting_payment") && c.reservedUntil <= now).slice(0, limit);
  }
  async isReservationActive(checkoutId: string, now: Date) {
    const rs = this.s.reservations.filter((r) => r.checkoutId === checkoutId);
    return rs.length > 0 && rs.every((r) => r.status === "active" && r.expiresAt > now);
  }
  async getOrder(id: string) { return this.s.orders.get(id) ?? null; }
  async getOrderByCheckout(checkoutId: string) { return [...this.s.orders.values()].find((o) => o.checkoutId === checkoutId) ?? null; }
  async updateOrderStatus(orderId: string, ev: OrderEventInput, now: Date) {
    const o = this.s.orders.get(orderId);
    if (!o || o.status !== ev.fromStatus) return false;
    o.status = ev.toStatus;
    if (ev.toStatus === "paid") o.paidAt = now;
    this.s.orderEvents.push({ ...ev, orderId, at: now });
    return true;
  }
  async recordPaymentEvent(provider: PaymentProviderName, eventId: string, type: string) {
    const k = `${provider}:${eventId}`;
    const e = this.s.paymentEvents.get(k);
    if (e) return { inserted: false, processed: e.processed };
    this.s.paymentEvents.set(k, { type, processed: false, error: null });
    return { inserted: true, processed: false };
  }
  async markPaymentEventProcessed(provider: PaymentProviderName, eventId: string, error: string | null) {
    const e = this.s.paymentEvents.get(`${provider}:${eventId}`);
    if (e) { e.processed = true; e.error = error; }
  }
  async upsertPayment(p: Parameters<CommerceRepo["upsertPayment"]>[0]) {
    this.s.payments.set(`${p.provider}:${p.providerPaymentId}`, { orderId: p.orderId, provider: p.provider, providerPaymentId: p.providerPaymentId, amountMinor: p.amountMinor, currency: p.currency, status: p.status });
  }
  async recordRefund(r: Parameters<CommerceRepo["recordRefund"]>[0]) {
    const prev = this.s.refunds.get(r.idempotencyKey);
    if (prev && prev.status === "succeeded") return;
    this.s.refunds.set(r.idempotencyKey, { orderId: r.orderId, amountMinor: r.amountMinor, status: r.status, providerRefundId: r.providerRefundId });
  }
  async insertProviderTxn(t: Omit<ProviderTxn, "seq">) {
    const k = `${t.provider}:${t.providerTxnId}`;
    const existing = this.s.providerTxns.get(k);
    if (existing) return { created: false, txn: existing };
    const txn = { ...t, seq: ++this.s.seq };
    this.s.providerTxns.set(k, txn);
    return { created: true, txn };
  }
  async getProviderTxn(provider: PaymentProviderName, id: string) { return this.s.providerTxns.get(`${provider}:${id}`) ?? null; }
  async getProviderTxnBySeq(provider: PaymentProviderName, seq: number) {
    return [...this.s.providerTxns.values()].find((t) => t.provider === provider && t.seq === seq) ?? null;
  }
  async findOpenProviderTxns(provider: PaymentProviderName, checkoutId: string) {
    return [...this.s.providerTxns.values()].filter((t) => t.provider === provider && t.checkoutId === checkoutId && (t.state === 1 || t.state === 2));
  }
  async updateProviderTxn(provider: PaymentProviderName, id: string, expected: ProviderTxn["state"], patch: Partial<ProviderTxn>) {
    const t = this.s.providerTxns.get(`${provider}:${id}`);
    if (!t || t.state !== expected) return null;
    Object.assign(t, patch);
    return t;
  }
  async listProviderTxns(provider: PaymentProviderName, from: number, to: number) {
    return [...this.s.providerTxns.values()].filter((t) => t.provider === provider && t.providerTime >= from && t.providerTime <= to).sort((a, b) => a.providerTime - b.providerTime);
  }

  // ---------- InventoryService fake (semantics of the SQL functions)
  async reserve(checkoutId: string, lines: ReserveLine[], expiresAt: Date): Promise<ReserveResult> {
    const bad: string[] = [];
    for (const l of lines) {
      const v = this.s.variants.get(l.variantId);
      if (!Number.isInteger(l.quantity) || l.quantity < 1 || !v || !v.isActive || v.stockOnHand - v.stockReserved < l.quantity) bad.push(l.variantId);
    }
    if (bad.length) return { ok: false, code: "OUT_OF_STOCK", variantIds: bad };
    for (const l of lines) {
      this.s.variants.get(l.variantId)!.stockReserved += l.quantity;
      this.s.reservations.push({ id: randomUUID(), variantId: l.variantId, checkoutId, quantity: l.quantity, expiresAt, status: "active" });
    }
    return { ok: true };
  }
  private releaseRows(rows: Reservation[]) {
    for (const r of rows) { this.s.variants.get(r.variantId)!.stockReserved -= r.quantity; r.status = "released"; }
    return rows.length;
  }
  async release(checkoutId: string, _reason: ReleaseReason) {
    return this.releaseRows(this.s.reservations.filter((r) => r.checkoutId === checkoutId && r.status === "active"));
  }
  async releaseExpired(now: Date = this.clock()) {
    return this.releaseRows(this.s.reservations.filter((r) => r.status === "active" && r.expiresAt <= now));
  }
  async convert(checkoutId: string, input: ConvertOrderInput): Promise<ConvertResult> {
    // fully synchronous body = atomic, like the row-locked SQL function (no interleaving between check and write)
    const existing = [...this.s.orders.values()].find((o) => o.checkoutId === checkoutId);
    if (existing) return { status: "already_converted", orderId: existing.id, reference: existing.reference };
    const c = this.s.checkouts.get(checkoutId);
    if (!c) throw new Error("checkout not found");
    const rs = this.s.reservations.filter((r) => r.checkoutId === checkoutId);
    const conflict = rs.filter((r) => r.status !== "active" || r.expiresAt <= input.paidAt);
    const orderId = randomUUID();
    const base: OrderRow = { id: orderId, reference: input.reference, checkoutId, status: "pending_payment", totalMinor: c.totalMinor, currency: c.currency, items: c.items, paidAt: null };
    let to: OrderStatus;
    if (conflict.length || rs.length === 0) {
      this.releaseRows(rs.filter((r) => r.status === "active"));
      to = "stock_conflict";
    } else {
      for (const r of rs) {
        const v = this.s.variants.get(r.variantId)!;
        v.stockOnHand -= r.quantity; v.stockReserved -= r.quantity; r.status = "converted";
        this.s.movements.push({ variantId: r.variantId, delta: -r.quantity, reason: "sale", orderId, note: null, actorId: null });
      }
      to = "paid";
    }
    this.s.orders.set(orderId, { ...base, status: to, paidAt: to === "paid" ? input.paidAt : null });
    this.s.orderEvents.push({ orderId, type: to === "paid" ? "payment_received" : "stock_conflict", fromStatus: "pending_payment", toStatus: to, payload: { provider: input.provider, providerPaymentId: input.providerPaymentId }, actorId: null, at: input.paidAt });
    c.status = "completed";
    return to === "paid" ? { status: "paid", orderId, reference: input.reference } : { status: "stock_conflict", orderId, reference: input.reference, conflictVariantIds: conflict.map((r) => r.variantId) };
  }
  async adjust(input: AdjustStockInput, actorId: string) {
    const v = this.s.variants.get(input.variantId);
    if (!v) throw new Error("variant not found");
    if (!Number.isInteger(input.delta) || input.delta === 0 || v.stockOnHand + input.delta < v.stockReserved) throw new Error("invalid delta");
    v.stockOnHand += input.delta;
    this.s.movements.push({ variantId: input.variantId, delta: input.delta, reason: input.reason, orderId: null, note: input.note ?? null, actorId });
    return { stockOnHand: v.stockOnHand };
  }
}
