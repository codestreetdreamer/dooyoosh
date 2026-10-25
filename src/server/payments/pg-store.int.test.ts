/**
 * Postgres integration tests for PgStore against Backend's migrations (feat/db, 0000-0007) on a PRIVATE local DB.
 * Skipped unless PAYMENTS_TEST_DATABASE_URL is set. Never point it at Supabase or a shared server.
 *   PAYMENTS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/dy_pay pnpm exec vitest run --config src/server/payments/vitest.config.ts
 * Each test creates its own published product + variants (unique slug/sku) and sets stock via adjust_stock.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { ApiError } from "@/lib/errors";
import { createCheckout, getCheckoutStatus } from "../checkout/service";
import { hashAccessToken } from "../checkout/token";
import { adminListOrders, adminRefundOrder } from "../orders/admin";
import { ADMIN_DEV_ACTOR_ID } from "../orders/admin-auth";
import { getPublicOrder } from "../orders/view";
import type { PaymentConfig } from "./config";
import type { PaymentDeps } from "./deps";
import { createProvider } from "./registry";
import { simulateSandboxPayment } from "./sandbox";
import { createPgClient, PgStore } from "./pg-store";
import type { PaymeAdapter } from "./payme/adapter";
import { PAYME_KEY, SECRET, TOKEN_SECRET, silentNotifier } from "./__tests__/fixtures";

const URL_ = process.env.PAYMENTS_TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const actor = { actorId: ADMIN_DEV_ACTOR_ID, role: "owner" as const };

let sql: postgres.Sql;
let store: PgStore;
let methodId: string;

function deps(provider: "mock" | "payme" = "mock") {
  const config: PaymentConfig = {
    provider, mode: "sandbox", siteUrl: "https://shop.example", nodeEnv: "test", tokenSecret: TOKEN_SECRET,
    mock: { webhookSecret: SECRET },
    payme: { merchantId: "587f72c72cac0d162c722ae2", key: PAYME_KEY, login: "Paycom", accountField: "order_id", enforceIp: false },
  };
  const dep: PaymentDeps = { repo: store, inventory: store, notifier: silentNotifier(), config, now: () => new Date() };
  return { deps: dep, provider: createProvider(config, dep) };
}

async function product(stocks: number[]) {
  const tag = randomUUID().slice(0, 8);
  const [cat] = await sql`select category_id from products limit 1`;
  const [p] = await sql`insert into products (slug, category_id, status, base_price_cents, currency, size_system, ikpu_code, vat_rate_bp, published_at)
    values (${`it-${tag}`}, ${cat!.category_id}, 'published', 10000000, 'UZS', 'one_size', 'DEMO-06204400100000001', 1200, now() - interval '1 day') returning id`;
  await sql`insert into product_translations (product_id, locale, name) values (${p!.id}, 'en', ${`IT product ${tag}`})`;
  const vids: string[] = [];
  for (const [i, n] of stocks.entries()) {
    const [v] = await sql`insert into product_variants (product_id, sku, size) values (${p!.id}, ${`IT-${tag}-${i}`}, ${`S${i}`}) returning id`;
    if (n) await sql`select adjust_stock(${v!.id}, ${n}, 'restock', 'it seed', null)`;
    vids.push(String(v!.id));
  }
  return vids;
}
const req = (items: { variantId: string; quantity: number }[], over: Record<string, unknown> = {}) => ({
  email: "it@example.com", locale: "en" as const, items, shippingAddress: { fullName: "IT Buyer", line1: "Amir Temur 1", city: "Tashkent", country: "UZ" }, shippingMethodId: methodId, ...over,
});
const stock = async (id: string) => { const [r] = await sql`select stock_on_hand::int as h, stock_reserved::int as r from product_variants where id = ${id}`; return { onHand: r!.h as number, reserved: r!.r as number }; };
async function apiError(p: Promise<unknown>) { try { await p; } catch (e) { if (e instanceof ApiError) return e; throw e; } throw new Error("expected ApiError"); }

d("PgStore (local Postgres, Backend migrations)", () => {
  beforeAll(async () => {
    sql = createPgClient(URL_!);
    store = new PgStore(sql);
    const [m] = await sql`select sm.id from shipping_methods sm join countries c on c.market_id = sm.market_id where c.iso2 = 'UZ' and sm.is_active limit 1`;
    methodId = String(m!.id);
  });
  afterAll(async () => { await store?.close(); });

  it("checkout: server price, reserve_checkout, only the token HASH is stored", async () => {
    const [v] = await product([3]);
    const { deps: dp, provider } = deps();
    const key = randomUUID();
    const c = await createCheckout(dp, provider, req([{ variantId: v!, quantity: 2 }], { idempotencyKey: key }));
    expect(c.totals.subtotalMinor).toBe(20000000);
    expect(await stock(v!)).toEqual({ onHand: 3, reserved: 2 });
    const [row] = await sql`select row_to_json(c)::text as j, access_token_hash, idempotency_payload_hash, status, reserved_until, shipping_method_name from checkouts c where id = ${c.checkoutId}`;
    expect(row!.access_token_hash).toBe(hashAccessToken(TOKEN_SECRET, c.accessToken));
    expect(String(row!.j)).not.toContain(c.accessToken);
    expect(row!.idempotency_payload_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.status).toBe("awaiting_payment");
    expect(row!.reserved_until).not.toBeNull();
    expect(row!.shipping_method_name).toBeTruthy();
    expect(String(row!.shipping_method_name).length).toBeGreaterThanOrEqual(1);
    expect((await getCheckoutStatus(dp, c.checkoutId, c.accessToken)).checkoutStatus).toBe("awaiting_payment");
  });

  it("idempotency: replay same token/no second reservation; different payload -> IDEMPOTENCY_CONFLICT; 6 parallel -> 1 checkout", async () => {
    const [v] = await product([5]);
    const { deps: dp, provider } = deps();
    const key = randomUUID();
    const a = await createCheckout(dp, provider, req([{ variantId: v!, quantity: 1 }], { idempotencyKey: key }));
    const b = await createCheckout(dp, provider, req([{ variantId: v!, quantity: 1 }], { idempotencyKey: key }));
    expect(b.checkoutId).toBe(a.checkoutId);
    expect(b.accessToken).toBe(a.accessToken);
    expect(b.replayed).toBe(true);
    expect((await apiError(createCheckout(dp, provider, req([{ variantId: v!, quantity: 2 }], { idempotencyKey: key })))).code).toBe("IDEMPOTENCY_CONFLICT");
    const k2 = randomUUID();
    const rs = await Promise.all(Array.from({ length: 6 }, () => createCheckout(dp, provider, req([{ variantId: v!, quantity: 1 }], { idempotencyKey: k2 }))));
    expect(new Set(rs.map((r) => r.checkoutId)).size).toBe(1);
    expect(new Set(rs.map((r) => r.accessToken)).size).toBe(1);
    expect(await stock(v!)).toEqual({ onHand: 5, reserved: 2 });
  });

  it("race for the last unit: exactly one reservation, loser gets OUT_OF_STOCK with ids only", async () => {
    const [v] = await product([1]);
    const { deps: dp, provider } = deps();
    const rs = await Promise.allSettled(Array.from({ length: 5 }, () => createCheckout(dp, provider, req([{ variantId: v!, quantity: 1 }]))));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of rs) if (r.status === "rejected") { expect((r.reason as ApiError).code).toBe("OUT_OF_STOCK"); expect((r.reason as ApiError).details).toEqual({ variantIds: [v] }); }
    expect(await stock(v!)).toEqual({ onHand: 1, reserved: 1 });
  });

  it("mock success -> convert (record) -> order paid, stock sold once, duplicate event no-op, guest view, refund with text key", async () => {
    const [v1, v2] = await product([4, 2]);
    const { deps: dp, provider } = deps();
    const c = await createCheckout(dp, provider, req([{ variantId: v1!, quantity: 2 }, { variantId: v2!, quantity: 1 }]));
    await simulateSandboxPayment(dp, provider, c.checkoutId, c.accessToken, "success");
    const again = await simulateSandboxPayment(dp, provider, c.checkoutId, c.accessToken, "success");
    expect(JSON.parse(again[0]!.body).outcome).toBe("duplicate");
    expect(await stock(v1!)).toEqual({ onHand: 2, reserved: 0 });
    const order = (await store.getOrderByCheckout(c.checkoutId))!;
    expect(order.status).toBe("paid");
    expect(order.items.map((i) => i.quantity).sort()).toEqual([1, 2]);
    const [cnt] = await sql`select count(*)::int as n from orders where checkout_id = ${c.checkoutId}`;
    expect(cnt!.n).toBe(1);
    const pub = await getPublicOrder(dp, order.reference, c.accessToken);
    expect(pub.status).toBe("paid");
    await expect(getPublicOrder(dp, order.reference, "x".repeat(43))).rejects.toMatchObject({ code: "NOT_FOUND" });
    const k = randomUUID();
    const providers = new Map([[provider.name, provider]]);
    const r1 = await adminRefundOrder(dp, providers, order.id, { amountMinor: 1000000, reason: "it", idempotencyKey: k }, actor);
    const r2 = await adminRefundOrder(dp, providers, order.id, { amountMinor: 1000000, reason: "it", idempotencyKey: k }, actor);
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(false);
    const [ref] = await sql`select idempotency_key, status from refunds where idempotency_key = ${`admin:${k}`}`;
    expect(ref).toMatchObject({ idempotency_key: `admin:${k}`, status: "succeeded" });
    expect((await store.getOrder(order.id))!.status).toBe("partially_refunded");
    const list = await adminListOrders(dp, { q: order.reference, limit: 5 });
    expect(list.data.map((o) => o.reference)).toEqual([order.reference]);
  });

  it("mock fail -> release_checkout: reservation released, checkout failed", async () => {
    const [v] = await product([1]);
    const { deps: dp, provider } = deps();
    const c = await createCheckout(dp, provider, req([{ variantId: v!, quantity: 1 }]));
    await simulateSandboxPayment(dp, provider, c.checkoutId, c.accessToken, "fail");
    expect(await stock(v!)).toEqual({ onHand: 1, reserved: 0 });
    expect((await getCheckoutStatus(dp, c.checkoutId, c.accessToken)).checkoutStatus).toBe("failed");
  });

  it("Payme: Create/Perform write provider_transactions (seq, provider_time); Cancel after Perform -> refunded + restock", async () => {
    const [v] = await product([3]);
    const { deps: dp, provider } = deps("payme");
    const c = await createCheckout(dp, provider, req([{ variantId: v!, quantity: 1 }]));
    const a = provider as PaymeAdapter;
    const auth = `Basic ${Buffer.from(`Paycom:${PAYME_KEY}`).toString("base64")}`;
    let n = 0;
    const rpc = async (method: string, params: Record<string, unknown>) => (await a.handleRpc(JSON.stringify({ method, params, id: ++n }), new Headers({ authorization: auth }), { method: "POST", ip: "185.234.113.1" })) as { result?: Record<string, unknown>; error?: { code: number } };
    const id = randomUUID().replace(/-/g, "").slice(0, 24);
    const time = Date.now();
    const cr = await rpc("CreateTransaction", { id, time, amount: c.totals.totalMinor, account: { order_id: c.checkoutId } });
    expect(cr.result?.state).toBe(1);
    const cr2 = await rpc("CreateTransaction", { id, time, amount: c.totals.totalMinor, account: { order_id: c.checkoutId } });
    expect(cr2.result).toEqual(cr.result);
    const [t] = await sql`select seq, provider_time, state from provider_transactions where provider = 'payme' and provider_txn_id = ${id}`;
    expect(Number(t!.provider_time)).toBe(time);
    expect(cr.result?.transaction).toBe(String(t!.seq));
    expect((await rpc("PerformTransaction", { id })).result?.state).toBe(2);
    expect(await stock(v!)).toEqual({ onHand: 2, reserved: 0 });
    const st = await rpc("GetStatement", { from: time - 1, to: time + 1 });
    expect((st.result?.transactions as unknown[]).length).toBe(1);
    expect((await rpc("CancelTransaction", { id, reason: 5 })).result?.state).toBe(-2);
    const o = (await store.getOrderByCheckout(c.checkoutId))!;
    expect(o.status).toBe("refunded");
    expect(await stock(v!)).toEqual({ onHand: 3, reserved: 0 });
    expect((await rpc("CancelTransaction", { id, reason: 5 })).result?.state).toBe(-2);
    expect(await stock(v!)).toEqual({ onHand: 3, reserved: 0 });
  });

  it("Payme Perform after reservation released: convert 'abort' writes nothing -> -31008, txn canceled", async () => {
    const [v] = await product([2]);
    const { deps: dp, provider } = deps("payme");
    const c = await createCheckout(dp, provider, req([{ variantId: v!, quantity: 1 }]));
    const a = provider as PaymeAdapter;
    const auth = `Basic ${Buffer.from(`Paycom:${PAYME_KEY}`).toString("base64")}`;
    const rpc = async (method: string, params: Record<string, unknown>) => (await a.handleRpc(JSON.stringify({ method, params, id: 1 }), new Headers({ authorization: auth }), { method: "POST", ip: "185.234.113.1" })) as { result?: Record<string, unknown>; error?: { code: number } };
    const id = randomUUID().replace(/-/g, "").slice(0, 24);
    await rpc("CreateTransaction", { id, time: Date.now(), amount: c.totals.totalMinor, account: { order_id: c.checkoutId } });
    // race: our pre-check still sees the reservation as active, but the sweep releases it before convert
    const orig = store.isReservationActive.bind(store);
    store.isReservationActive = async () => true;
    await sql`select release_checkout(${c.checkoutId}, 'expired')`;
    try {
      expect((await rpc("PerformTransaction", { id })).error?.code).toBe(-31008);
    } finally { store.isReservationActive = orig; }
    const [cnt] = await sql`select count(*)::int as n from orders where checkout_id = ${c.checkoutId}`;
    expect(cnt!.n).toBe(0);
    const [pt] = await sql`select state from provider_transactions where provider_txn_id = ${id}`;
    expect(pt!.state).toBe("canceled");
    expect(await stock(v!)).toEqual({ onHand: 2, reserved: 0 });
  });

  it("0009: convert treats expires_at <= paid_at as conflict even if status is still active (record + abort)", async () => {
    const [v] = await product([2]);
    const { deps: dp, provider } = deps();
    const c = await createCheckout(dp, provider, req([{ variantId: v!, quantity: 1 }]));
    // push expires_at into the past without releasing (sweeper has not run)
    await sql`update stock_reservations set expires_at = now() - interval '1 minute' where checkout_id = ${c.checkoutId}`;
    const aborted = await store.convert(c.checkoutId, { reference: "DY-20990101-AAAA2", provider: "mock", providerPaymentId: `abort_${c.checkoutId}`, amountMinor: c.totals.totalMinor, currency: "UZS", paidAt: new Date() }, { conflictMode: "abort" });
    expect(aborted.status).toBe("aborted");
    expect((await sql`select count(*)::int as n from orders where checkout_id = ${c.checkoutId}`)[0]!.n).toBe(0);
    // restore active so record path can write stock_conflict (reservation still active but expired)
    const recorded = await store.convert(c.checkoutId, { reference: "DY-20990101-BBBB2", provider: "mock", providerPaymentId: `rec_${c.checkoutId}`, amountMinor: c.totals.totalMinor, currency: "UZS", paidAt: new Date() }, { conflictMode: "record" });
    expect(recorded.status).toBe("stock_conflict");
    expect((await store.getOrderByCheckout(c.checkoutId))!.status).toBe("stock_conflict");
  });

  it("adjust_stock with null actor + admin actor; never below reserved", async () => {
    const [v] = await product([2]);
    expect(await store.adjust({ variantId: v!, delta: 3, reason: "restock" }, null)).toEqual({ stockOnHand: 5 });
    expect(await store.adjust({ variantId: v!, delta: -1, reason: "damage", note: "it" }, ADMIN_DEV_ACTOR_ID)).toEqual({ stockOnHand: 4 });
    await expect(store.adjust({ variantId: v!, delta: -10, reason: "adjustment" }, null)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
