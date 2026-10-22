/**
 * Postgres CommerceRepo + InventoryService over Backend & Database's schema and SECURITY DEFINER functions
 * (feat/db, migrations 0000-0006, docs/DATABASE.md §4). Owner: Payments & Orders.
 *
 *  - stock only via reserve_checkout / convert_checkout_to_order / release_checkout / release_expired_reservations /
 *    adjust_stock / restock_order (never direct UPDATEs of stock columns)
 *  - idempotency: checkouts.idempotency_payload_hash + checkout_id_for_idempotency_key(); payment_events via
 *    record_payment_event / mark_payment_event_processed; refunds.idempotency_key text UNIQUE
 *  - provider_transactions: seq (identity, never inserted), provider_time (ms), state enum <-> Payme numeric state
 *  - raw guest token never reaches the DB: only access_token_hash (HMAC hex, computed in checkout/token.ts)
 * Function errors are RAISE '<CODE>' USING ERRCODE 'P0001', DETAIL json (DATABASE.md §4) -> ApiError / ReserveResult.
 */
import postgres from "postgres";
import type { OrderStatus } from "@/contracts/orders";
import type { CheckoutStatus } from "@/contracts/checkout";
import { ApiError } from "@/lib/errors";
import type { AdjustStockInput, ConvertOrderInput, ConvertResult, InventoryService, PaymentProviderName, ReleaseReason, ReserveLine, ReserveResult, TxLike } from "./types";
import type {
  CheckoutLine, CheckoutRow, CommerceRepo, NewCheckout, OrderDetail, OrderEventInput, OrderListItem, OrderListQuery, OrderRow,
  PaymentRow, ProviderTxn, RefundRow, ShipmentRow, ShippingMethodForCheckout, VariantForCheckout,
} from "./store";

type Sql = postgres.Sql | postgres.TransactionSql;
type Row = Record<string, unknown>;

const STATE_TO_DB = { 1: "created", 2: "performed", [-1]: "canceled", [-2]: "canceled_after_perform" } as const;
const STATE_FROM_DB: Record<string, ProviderTxn["state"]> = { created: 1, performed: 2, canceled: -1, canceled_after_perform: -2 };

/** Postgres P0001 raised by our SQL functions: message = code, detail = json. */
export function pgAppError(e: unknown): { code: string; detail: unknown } | null {
  const err = e as { code?: unknown; message?: unknown; detail?: unknown } | null;
  if (!err || err.code !== "P0001" || typeof err.message !== "string") return null;
  let detail: unknown = null;
  try { detail = typeof err.detail === "string" ? JSON.parse(err.detail) : null; } catch { detail = err.detail; }
  return { code: err.message, detail };
}
const ids = (d: unknown) => (Array.isArray(d) ? d.map(String) : []);
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const ms = (d: unknown) => (d instanceof Date ? d.getTime() : 0);

export function createPgClient(url: string): postgres.Sql {
  // prepare:false = Supabase transaction pooler (6543) safe; bigint -> number (all *_cents < 2^53)
  return postgres(url, { prepare: false, max: 5, idle_timeout: 20, types: { bigint: { to: 20, from: [20], serialize: (x: number | bigint) => String(x), parse: (x: string) => Number(x) } }, transform: { undefined: null } });
}

function toLine(r: Row): CheckoutLine {
  return {
    variantId: String(r.variant_id ?? ""), sku: String(r.sku), productName: String(r.product_name), size: (r.size as string) ?? null, colour: (r.colour as string) ?? null,
    unitPriceMinor: num(r.unit_price_cents), quantity: num(r.quantity), lineTotalMinor: num(r.line_total_cents),
    ikpuCode: (r.ikpu_code as string) ?? null, packageCode: (r.package_code as string) ?? null, vatRateBp: num(r.vat_rate_bp),
  } as CheckoutLine;
}

function toCheckout(r: Row): CheckoutRow {
  return {
    id: String(r.id), idempotencyKey: (r.idempotency_key as string) ?? null, idempotencyPayloadHash: (r.idempotency_payload_hash as string) ?? null,
    accessTokenHash: String(r.access_token_hash), email: String(r.email), phone: (r.phone as string) ?? null, locale: String(r.locale), currency: String(r.currency),
    items: r.items as CheckoutLine[], shippingAddress: r.shipping_address as CheckoutRow["shippingAddress"], billingAddress: (r.billing_address as CheckoutRow["billingAddress"]) ?? null,
    shippingMethodId: String(r.shipping_method_id), shippingName: String(r.shipping_name ?? ""),
    subtotalMinor: num(r.subtotal_cents), shippingMinor: num(r.shipping_cents), taxMinor: num(r.tax_cents), discountMinor: num(r.discount_cents), totalMinor: num(r.total_cents),
    provider: r.provider as PaymentProviderName, expiresAt: r.expires_at as Date, reservedUntil: (r.reserved_until as Date) ?? (r.expires_at as Date),
    status: r.status as CheckoutStatus, providerSessionId: (r.provider_session_id as string) ?? null, createdAt: r.created_at as Date,
  };
}

function toTxn(r: Row): ProviderTxn {
  return {
    provider: r.provider as PaymentProviderName, providerTxnId: String(r.provider_txn_id), seq: num(r.seq), checkoutId: String(r.checkout_id),
    amountMinor: num(r.amount_cents), currency: String(r.currency), state: STATE_FROM_DB[String(r.state)]!, reason: r.cancel_reason === null ? null : num(r.cancel_reason),
    providerTime: num(r.provider_time), createTime: ms(r.created_at), performTime: ms(r.performed_at), cancelTime: ms(r.canceled_at),
    orderId: (r.order_id as string) ?? null, raw: (r.raw as Record<string, unknown>) ?? {},
  };
}

const toRefund = (r: Row): RefundRow => ({
  id: String(r.id), paymentId: String(r.payment_id), orderId: String(r.order_id), amountMinor: num(r.amount_cents), reason: (r.reason as string) ?? null,
  providerRefundId: (r.provider_refund_id as string) ?? null, status: r.status as RefundRow["status"], idempotencyKey: String(r.idempotency_key), createdAt: r.created_at as Date,
});
const toPayment = (r: Row): PaymentRow => ({
  id: String(r.id), provider: r.provider as PaymentProviderName, providerPaymentId: String(r.provider_payment_id), amountMinor: num(r.amount_cents), currency: String(r.currency),
  status: r.status as PaymentRow["status"], createdAt: r.created_at as Date,
});
const toShipment = (r: Row): ShipmentRow => ({
  id: String(r.id), orderId: String(r.order_id), carrier: String(r.carrier), trackingNumber: (r.tracking_number as string) ?? null, trackingUrl: (r.tracking_url as string) ?? null,
  status: r.status as ShipmentRow["status"], shippedAt: (r.shipped_at as Date) ?? null, deliveredAt: (r.delivered_at as Date) ?? null,
});

const CHECKOUT_COLS = (s: Sql) => s`c.*, (extract(epoch from c.created_at)) as _e, sm.name as shipping_name`;

export class PgStore implements CommerceRepo, InventoryService {
  constructor(private readonly sql: postgres.Sql) {}
  private q(tx?: TxLike): Sql { return (tx as Sql | undefined) ?? this.sql; }
  async close() { await this.sql.end({ timeout: 5 }); }

  async runInTransaction<T>(fn: (tx: TxLike) => Promise<T>): Promise<T> {
    return (await this.sql.begin((tx) => fn(tx))) as T;
  }

  // ---------- catalog / shipping reads (Backend-owned tables, read only)
  async getVariantsForCheckout(variantIds: string[], locale: string): Promise<VariantForCheckout[]> {
    if (!variantIds.length) return [];
    const rows = await this.sql`
      select v.id, v.sku, v.size, v.colour, coalesce(v.price_cents, p.base_price_cents) as price, p.currency, v.is_active,
             (p.status = 'published' and p.archived_at is null and (p.published_at is null or p.published_at <= now())) as published,
             greatest(v.stock_on_hand - v.stock_reserved, 0) as available, v.weight_grams, p.ikpu_code, p.package_code, p.vat_rate_bp,
             coalesce(t.name, te.name, p.slug) as name
        from product_variants v join products p on p.id = v.product_id
        left join product_translations t on t.product_id = p.id and t.locale = ${locale}
        left join product_translations te on te.product_id = p.id and te.locale = 'en'
       where v.id = any(${variantIds}::uuid[])`;
    return rows.map((r) => ({
      variantId: String(r.id), sku: String(r.sku), productName: String(r.name), size: r.size ?? null, colour: r.colour ?? null,
      unitPriceMinor: num(r.price), currency: String(r.currency).trim(), isActive: !!r.is_active, isPublished: !!r.published, available: num(r.available),
      weightGrams: r.weight_grams === null ? null : num(r.weight_grams), ikpuCode: r.ikpu_code ?? null, packageCode: r.package_code ?? null, vatRateBp: num(r.vat_rate_bp),
    }));
  }
  async getVariantStock(variantId: string) {
    const [r] = await this.sql`select stock_on_hand, stock_reserved from product_variants where id = ${variantId}`;
    if (!r) throw ApiError.notFound("variant not found");
    return { stockOnHand: num(r.stock_on_hand), stockReserved: num(r.stock_reserved) };
  }
  async getShippingMethod(methodId: string, countryIso2: string): Promise<ShippingMethodForCheckout | null> {
    const [m] = await this.sql`
      select sm.id, sm.name, sm.is_active, mk.currency, mk.is_active as market_active,
             exists(select 1 from countries c where c.iso2 = ${countryIso2} and c.is_shippable and c.market_id = sm.market_id) as shippable
        from shipping_methods sm join markets mk on mk.id = sm.market_id where sm.id = ${methodId}`;
    if (!m) return null;
    const rates = await this.sql`select min_subtotal_cents, max_weight_grams, price_cents, free_over_cents from shipping_rates where shipping_method_id = ${methodId} order by min_subtotal_cents`;
    return {
      methodId: String(m.id), name: String(m.name), isActive: !!m.is_active, marketCurrency: String(m.currency).trim(), marketActive: !!m.market_active, countryShippable: !!m.shippable,
      rates: rates.map((r) => ({ minSubtotalMinor: num(r.min_subtotal_cents), maxWeightGrams: r.max_weight_grams === null ? null : num(r.max_weight_grams), priceMinor: num(r.price_cents), freeOverMinor: r.free_over_cents === null ? null : num(r.free_over_cents) })),
    };
  }

  // ---------- checkouts
  async insertCheckout(c: NewCheckout, tx?: TxLike): Promise<void> {
    // TODO(Backend 0009): write c.shippingName into checkouts.shipping_method_name (snapshot, copied to orders) and read it
    // back in getCheckout instead of joining shipping_methods.name. Until then the name is joined live.
    // reserved_until is set by reserve_checkout.
    await this.q(tx)`
      insert into checkouts (id, email, phone, locale, currency, items, shipping_address, billing_address, shipping_method_id, idempotency_key,
        idempotency_payload_hash, subtotal_cents, shipping_cents, tax_cents, discount_cents, total_cents, provider, access_token_hash, status, expires_at)
      values (${c.id}, ${c.email}, ${c.phone}, ${c.locale}, ${c.currency}, ${this.sql.json(c.items as never)}, ${this.sql.json(c.shippingAddress as never)},
        ${c.billingAddress ? this.sql.json(c.billingAddress as never) : null}, ${c.shippingMethodId}, ${c.idempotencyKey}, ${c.idempotencyPayloadHash},
        ${c.subtotalMinor}, ${c.shippingMinor}, ${c.taxMinor}, ${c.discountMinor}, ${c.totalMinor}, ${c.provider}, ${c.accessTokenHash}, 'open', ${c.expiresAt})`;
  }
  async getCheckout(id: string): Promise<CheckoutRow | null> {
    const [r] = await this.sql`select ${CHECKOUT_COLS(this.sql)} from checkouts c join shipping_methods sm on sm.id = c.shipping_method_id where c.id = ${id}`;
    return r ? toCheckout(r) : null;
  }
  async checkoutIdForIdempotencyKey(key: string, payloadHash: string): Promise<string | null> {
    try {
      const [r] = await this.sql`select checkout_id_for_idempotency_key(${key}::uuid, ${payloadHash}) as id`;
      return (r?.id as string) ?? null;
    } catch (e) {
      if (pgAppError(e)?.code === "IDEMPOTENCY_CONFLICT") throw ApiError.idempotencyConflict();
      throw e;
    }
  }
  async setProviderSession(id: string, sessionId: string) {
    await this.sql`update checkouts set provider_session_id = ${sessionId}, status = case when status = 'open' then 'awaiting_payment'::checkout_status else status end, updated_at = now() where id = ${id}`;
  }
  async setCheckoutStatus(id: string, status: CheckoutStatus) {
    await this.sql`update checkouts set status = ${status}, updated_at = now() where id = ${id}`;
  }
  async listExpiredCheckouts(now: Date, limit: number): Promise<CheckoutRow[]> {
    const rows = await this.sql`select ${CHECKOUT_COLS(this.sql)} from checkouts c join shipping_methods sm on sm.id = c.shipping_method_id
      where c.status in ('open','awaiting_payment') and coalesce(c.reserved_until, c.expires_at) <= ${now} order by c.expires_at limit ${limit}`;
    return rows.map(toCheckout);
  }
  async isReservationActive(checkoutId: string, now: Date) {
    const [r] = await this.sql`select count(*)::int as n, count(*) filter (where status = 'active' and expires_at > ${now})::int as ok from stock_reservations where checkout_id = ${checkoutId}`;
    return num(r!.n) > 0 && num(r!.n) === num(r!.ok);
  }

  // ---------- orders
  private async orderRow(where: postgres.PendingQuery<Row[]>): Promise<OrderRow | null> {
    const [o] = await where;
    if (!o) return null;
    const items = await this.sql`select * from order_items where order_id = ${String(o.id)} order by sku`;
    return { id: String(o.id), reference: String(o.reference), checkoutId: String(o.checkout_id), status: o.status as OrderStatus, totalMinor: num(o.total_cents), currency: String(o.currency), items: items.map(toLine), paidAt: (o.paid_at as Date) ?? null };
  }
  getOrder(id: string) { return this.orderRow(this.sql`select * from orders where id = ${id}`); }
  getOrderByCheckout(checkoutId: string) { return this.orderRow(this.sql`select * from orders where checkout_id = ${checkoutId}`); }
  async updateOrderStatus(orderId: string, ev: OrderEventInput, now: Date): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      const r = await tx`update orders set status = ${ev.toStatus}, updated_at = ${now}, paid_at = case when ${ev.toStatus} = 'paid' then ${now} else paid_at end
        where id = ${orderId} and status = ${ev.fromStatus} returning id`;
      if (!r.length) return false;
      await tx`insert into order_events (order_id, type, from_status, to_status, payload, actor_id, created_at)
        values (${orderId}, ${ev.type}, ${ev.fromStatus}, ${ev.toStatus}, ${this.sql.json(ev.payload as never)}, ${ev.actorId}, ${now})`;
      return true;
    }) as Promise<boolean>;
  }
  async getOrderDetail(orderId: string): Promise<OrderDetail | null> {
    const [o] = await this.sql`select * from orders where id = ${orderId}`;
    if (!o) return null;
    const [items, payments, refunds, shipments, events] = await Promise.all([
      this.sql`select * from order_items where order_id = ${orderId} order by sku`,
      this.sql`select * from payments where order_id = ${orderId} order by created_at`,
      this.sql`select r.*, p.order_id from refunds r join payments p on p.id = r.payment_id where p.order_id = ${orderId} order by r.created_at`,
      this.sql`select * from shipments where order_id = ${orderId} order by created_at`,
      this.sql`select * from order_events where order_id = ${orderId} order by created_at, id`,
    ]);
    return {
      id: String(o.id), reference: String(o.reference), checkoutId: String(o.checkout_id), status: o.status as OrderStatus, totalMinor: num(o.total_cents), currency: String(o.currency),
      items: items.map(toLine), paidAt: (o.paid_at as Date) ?? null, email: String(o.email), phone: o.phone ?? null, locale: String(o.locale), accessTokenHash: String(o.access_token_hash),
      shippingAddress: o.shipping_address, billingAddress: o.billing_address ?? null, shippingMethodId: String(o.shipping_method_id),
      subtotalMinor: num(o.subtotal_cents), shippingMinor: num(o.shipping_cents), taxMinor: num(o.tax_cents), discountMinor: num(o.discount_cents),
      placedAt: o.placed_at as Date, updatedAt: o.updated_at as Date,
      payments: payments.map(toPayment), refunds: refunds.map(toRefund), shipments: shipments.map(toShipment),
      events: events.map((e) => ({ id: String(e.id), type: String(e.type), fromStatus: e.from_status ?? null, toStatus: e.to_status ?? null, payload: e.payload, actorId: e.actor_id ?? null, createdAt: e.created_at as Date })),
    };
  }
  async getOrderIdByReference(reference: string) {
    const [r] = await this.sql`select id from orders where reference = ${reference}`;
    return (r?.id as string) ?? null;
  }
  async listOrders(q: OrderListQuery): Promise<{ items: OrderListItem[]; nextCursor: string | null }> {
    // keyset on (placed_at desc, id desc); cursor = base64url("<iso>|<id>")
    let cur: { at: Date; id: string } | null = null;
    if (q.cursor) {
      const [at, id] = Buffer.from(q.cursor, "base64url").toString().split("|");
      if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/i.test(id)) throw ApiError.validation("invalid cursor");
      cur = { at: new Date(at), id };
    }
    const needle = q.q ? `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
    const rows = await this.sql`
      select o.id, o.reference, o.email, o.status, o.currency, o.total_cents, o.placed_at, o.paid_at,
             (select coalesce(sum(quantity), 0)::int from order_items i where i.order_id = o.id) as item_count
        from orders o
       where (${q.status ?? null}::order_status is null or o.status = ${q.status ?? null}::order_status)
         and (${needle}::text is null or o.reference ilike ${needle} or o.email ilike ${needle})
         and (${cur?.at ?? null}::timestamptz is null or (o.placed_at, o.id) < (${cur?.at ?? null}::timestamptz, ${cur?.id ?? null}::uuid))
       order by o.placed_at desc, o.id desc limit ${q.limit + 1}`;
    const items = rows.slice(0, q.limit).map((r) => ({ id: String(r.id), reference: String(r.reference), email: String(r.email), status: r.status as OrderStatus, currency: String(r.currency), totalMinor: num(r.total_cents), itemCount: num(r.item_count), placedAt: r.placed_at as Date, paidAt: (r.paid_at as Date) ?? null }));
    const last = items.at(-1);
    return { items, nextCursor: rows.length > q.limit && last ? Buffer.from(`${last.placedAt.toISOString()}|${last.id}`).toString("base64url") : null };
  }
  async insertShipment(s: Omit<ShipmentRow, "id">): Promise<ShipmentRow> {
    const [r] = await this.sql`insert into shipments (order_id, carrier, tracking_number, tracking_url, status, shipped_at, delivered_at)
      values (${s.orderId}, ${s.carrier}, ${s.trackingNumber}, ${s.trackingUrl}, ${s.status}, ${s.shippedAt}, ${s.deliveredAt}) returning *`;
    return toShipment(r!);
  }
  async getRefundByIdempotencyKey(key: string) {
    const [r] = await this.sql`select r.*, p.order_id from refunds r join payments p on p.id = r.payment_id where r.idempotency_key = ${key}`;
    return r ? toRefund(r) : null;
  }

  // ---------- payments
  async recordPaymentEvent(provider: PaymentProviderName, eventId: string, type: string, payload: unknown) {
    const [r] = await this.sql`select record_payment_event(${provider}, ${eventId}, ${type}, ${payload === undefined ? null : this.sql.json(payload as never)}) as inserted`;
    if (r!.inserted) return { inserted: true, processed: false };
    const [e] = await this.sql`select processed_at from payment_events where provider = ${provider} and event_id = ${eventId}`;
    return { inserted: false, processed: !!e?.processed_at };
  }
  async markPaymentEventProcessed(provider: PaymentProviderName, eventId: string, error: string | null) {
    await this.sql`select mark_payment_event_processed(${provider}, ${eventId}, ${error})`;
  }
  async upsertPayment(p: Parameters<CommerceRepo["upsertPayment"]>[0]) {
    // convert_checkout_to_order already inserted the 'succeeded' row; this keeps status in sync (UNIQUE provider+provider_payment_id)
    await this.sql`insert into payments (order_id, provider, provider_payment_id, amount_cents, currency, status, raw)
      values (${p.orderId}, ${p.provider}, ${p.providerPaymentId}, ${p.amountMinor}, ${p.currency}, ${p.status}, ${p.raw === undefined ? null : this.sql.json(p.raw as never)})
      on conflict (provider, provider_payment_id) do update set status = excluded.status, raw = coalesce(excluded.raw, payments.raw)`;
  }
  // TODO(Backend 0009): insert r.orderId into refunds.order_id and read it directly (today derived via payments.order_id).
  async recordRefund(r: Parameters<CommerceRepo["recordRefund"]>[0]): Promise<RefundRow> {
    const [pay] = await this.sql`select id from payments where provider = ${r.provider} and provider_payment_id = ${r.providerPaymentId}`;
    if (!pay) throw new Error(`payment ${r.provider}:${r.providerPaymentId} not found for refund`);
    // a succeeded refund is final; otherwise the latest provider answer wins (pending -> succeeded)
    const [row] = await this.sql`
      insert into refunds (payment_id, provider, amount_cents, reason, provider_refund_id, status, idempotency_key)
      values (${pay.id}, ${r.provider}, ${r.amountMinor}, ${r.reason}, ${r.providerRefundId}, ${r.status}, ${r.idempotencyKey})
      on conflict (idempotency_key) do update set status = excluded.status, provider_refund_id = coalesce(excluded.provider_refund_id, refunds.provider_refund_id), updated_at = now()
        where refunds.status <> 'succeeded'
      returning *, ${r.orderId}::uuid as order_id`;
    return row ? toRefund(row) : (await this.getRefundByIdempotencyKey(r.idempotencyKey))!;
  }

  // ---------- provider transactions
  async insertProviderTxn(t: Omit<ProviderTxn, "seq">) {
    const ins = await this.sql`
      insert into provider_transactions (provider, provider_txn_id, checkout_id, order_id, state, amount_cents, currency, cancel_reason, raw, provider_time, created_at, performed_at, canceled_at)
      values (${t.provider}, ${t.providerTxnId}, ${t.checkoutId}, ${t.orderId}, ${STATE_TO_DB[t.state]}, ${t.amountMinor}, ${t.currency}, ${t.reason}, ${this.sql.json(t.raw as never)},
        ${t.providerTime || null}, to_timestamp(${t.createTime}::double precision / 1000), ${t.performTime ? new Date(t.performTime) : null}, ${t.cancelTime ? new Date(t.cancelTime) : null})
      on conflict (provider, provider_txn_id) do nothing returning *`;
    if (ins[0]) return { created: true, txn: toTxn(ins[0]) };
    return { created: false, txn: (await this.getProviderTxn(t.provider, t.providerTxnId))! };
  }
  async getProviderTxn(provider: PaymentProviderName, id: string) {
    const [r] = await this.sql`select * from provider_transactions where provider = ${provider} and provider_txn_id = ${id}`;
    return r ? toTxn(r) : null;
  }
  async getProviderTxnBySeq(provider: PaymentProviderName, seq: number) {
    const [r] = await this.sql`select * from provider_transactions where provider = ${provider} and seq = ${seq}`;
    return r ? toTxn(r) : null;
  }
  async findOpenProviderTxns(provider: PaymentProviderName, checkoutId: string) {
    const rows = await this.sql`select * from provider_transactions where provider = ${provider} and checkout_id = ${checkoutId} and state in ('created','performed') order by seq`;
    return rows.map(toTxn);
  }
  async updateProviderTxn(provider: PaymentProviderName, id: string, expected: ProviderTxn["state"], patch: Partial<ProviderTxn>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const set: Record<string, any> = { updated_at: new Date() };
    if (patch.state !== undefined) set.state = STATE_TO_DB[patch.state];
    if (patch.reason !== undefined) set.cancel_reason = patch.reason;
    if (patch.performTime !== undefined) set.performed_at = patch.performTime ? new Date(patch.performTime) : null;
    if (patch.cancelTime !== undefined) set.canceled_at = patch.cancelTime ? new Date(patch.cancelTime) : null;
    if (patch.orderId !== undefined) set.order_id = patch.orderId;
    if (patch.raw !== undefined) set.raw = this.sql.json(patch.raw as never);
    const cols = Object.keys(set);
    const [r] = await this.sql`update provider_transactions set ${this.sql(set, cols)} where provider = ${provider} and provider_txn_id = ${id} and state = ${STATE_TO_DB[expected]} returning *`;
    return r ? toTxn(r) : null;
  }
  async listProviderTxns(provider: PaymentProviderName, from: number, to: number) {
    const rows = await this.sql`select * from provider_transactions where provider = ${provider} and provider_time between ${from} and ${to} order by provider_time, seq`;
    return rows.map(toTxn);
  }

  // ---------- InventoryService (SQL functions)
  async reserve(checkoutId: string, lines: ReserveLine[], expiresAt: Date, tx?: TxLike): Promise<ReserveResult> {
    const s = this.q(tx);
    const [c] = await s`select idempotency_payload_hash from checkouts where id = ${checkoutId}`;
    try {
      await s`select reserve_checkout(${checkoutId}, ${this.sql.json(lines.map((l) => ({ variant_id: l.variantId, quantity: l.quantity })) as never)}, ${expiresAt}, ${(c?.idempotency_payload_hash as string) ?? null})`;
      return { ok: true };
    } catch (e) {
      const a = pgAppError(e);
      if (a?.code === "OUT_OF_STOCK" || a?.code === "PRICE_CHANGED") return { ok: false, code: a.code, variantIds: ids(a.detail) };
      if (a?.code === "IDEMPOTENCY_CONFLICT") throw ApiError.idempotencyConflict();
      // public route: never forward DB detail (may name stock state); only the code
      if (a?.code === "VALIDATION_ERROR") throw ApiError.validation("Invalid reservation");
      throw e;
    }
  }
  async convert(checkoutId: string, order: ConvertOrderInput, opts: { conflictMode?: "record" | "abort"; tx?: TxLike } = {}): Promise<ConvertResult> {
    const p = { reference: order.reference, provider: order.provider, provider_payment_id: order.providerPaymentId, amount_minor: order.amountMinor, currency: order.currency, paid_at: order.paidAt.toISOString() };
    const [r] = await this.q(opts.tx)`select convert_checkout_to_order(${checkoutId}, ${this.sql.json(p as never)}, ${opts.conflictMode ?? "record"}) as r`;
    const x = r!.r as { status: string; order_id: string | null; reference: string | null; conflict_variant_ids?: string[] };
    if (x.status === "aborted") return { status: "aborted", conflictVariantIds: x.conflict_variant_ids ?? [] };
    if (x.status === "stock_conflict") return { status: "stock_conflict", orderId: x.order_id!, reference: x.reference!, conflictVariantIds: x.conflict_variant_ids ?? [] };
    if (x.status === "already_converted") return { status: "already_converted", orderId: x.order_id!, reference: x.reference! };
    return { status: "paid", orderId: x.order_id!, reference: x.reference! };
  }
  async release(checkoutId: string, reason: ReleaseReason, tx?: TxLike): Promise<number> {
    const [r] = await this.q(tx)`select release_checkout(${checkoutId}, ${reason}) as n`;
    return num(r!.n);
  }
  async releaseExpired(now: Date = new Date(), limit = 500): Promise<number> {
    const [r] = await this.sql`select release_expired_reservations(${now}, ${limit}) as n`;
    return num(r!.n);
  }
  async adjust(input: AdjustStockInput, actorId: string | null) {
    try {
      const [r] = await this.sql`select adjust_stock(${input.variantId}, ${input.delta}, ${input.reason}, ${input.note ?? null}, ${actorId}) as n`;
      return { stockOnHand: num(r!.n) };
    } catch (e) {
      const a = pgAppError(e);
      if (a?.code === "NOT_FOUND") throw ApiError.notFound("variant not found");
      if (a) throw ApiError.validation(a.code, [a.detail]);
      throw e;
    }
  }
  async restockOrder(orderId: string, reason: "return" | "cancellation" = "return", actorId: string | null = null, note?: string) {
    const [r] = await this.sql`select restock_order(${orderId}, ${reason}, ${actorId}, ${note ?? null}) as n`;
    return num(r!.n);
  }
}
