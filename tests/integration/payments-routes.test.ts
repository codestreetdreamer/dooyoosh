/**
 * QA attack suite against the REAL route handlers in src/app/api/v1 (in-process, PAYMENTS_STORE=memory).
 * Skips until the Payments routes exist on the branch under test. Every request goes through the same
 * Request -> route.ts -> service path as `next start`; only the HTTP socket is skipped.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash, createHmac, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const HAS_ROUTES = fs.existsSync(path.join(ROOT, "src/app/api/v1/checkout/route.ts")) && fs.existsSync(path.join(ROOT, "src/server/payments/container.ts"));
const SECRET = "qa_mock_webhook_secret_0123456789abcdef";
const PAYME_KEY = "QA_PAYME_TEST_KEY_0123456789abcdef";
const CLICK_SECRET = "qa_click_secret";
const CRON = "qa_cron_secret_0123456789abcdef";
const B = "http://qa.local/api/v1";

type Mods = Awaited<ReturnType<typeof load>>;
async function load(provider: "mock" | "payme" | "click", extra: Record<string, string> = {}) {
  vi.resetModules();
  const env = { PAYMENTS_STORE: "memory", PAYMENT_PROVIDER: provider, PAYMENT_MODE: "sandbox", NEXT_PUBLIC_PAYMENT_MODE: "sandbox", SANDBOX_SIMULATOR_ENABLED: "true", PAYMENT_WEBHOOK_SECRET: SECRET,
    ORDER_TOKEN_SECRET: "qa_order_token_secret_0123456789abcdef0123", TOKEN_SECRET: "qa_order_token_secret_0123456789abcdef0123",
    CRON_SECRET: CRON, NEXT_PUBLIC_SITE_URL: "http://qa.local", PAYME_MERCHANT_ID: "qa-merchant", PAYME_KEY, PAYME_LOGIN: "Paycom",
    PAYME_ACCOUNT_FIELD: "order_id", CLICK_SERVICE_ID: "123", CLICK_MERCHANT_ID: "456", CLICK_SECRET_KEY: CLICK_SECRET, DEFAULT_CURRENCY: "UZS", ...extra };
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const container = await import("@/server/payments/container");
  const checkout = await import("@/app/api/v1/checkout/route");
  const status = await import("@/app/api/v1/checkout/[checkoutId]/status/route");
  const sandbox = await import("@/app/api/v1/checkout/[checkoutId]/sandbox-pay/route");
  const webhook = await import("@/app/api/v1/webhooks/[provider]/route");
  const cron = await import("@/app/api/v1/cron/release-expired/route");
  const store = container.getPayments().deps.repo as unknown as {
    addVariant: (v: Record<string, unknown>) => void; addShippingMethod: (m: Record<string, unknown>) => void;
    stock: (id: string) => { onHand: number; reserved: number }; s: { orders: Map<string, { status: string; checkoutId: string }>; movements: { variantId: string; delta: number; reason: string }[] };
  };
  const v = randomUUID(), soldOut = randomUUID(), inactive = randomUUID(), methodId = randomUUID();
  store.addVariant({ variantId: v, sku: "DEMO-QA-1", productName: "QA dress", size: "M", unitPriceMinor: 125_000_000, currency: "UZS", stockOnHand: 3, weightGrams: 300 });
  store.addVariant({ variantId: soldOut, sku: "DEMO-QA-2", productName: "QA sold out", unitPriceMinor: 10_000_000, currency: "UZS", stockOnHand: 0, weightGrams: 300 });
  store.addVariant({ variantId: inactive, sku: "DEMO-QA-3", productName: "QA inactive", unitPriceMinor: 10_000_000, currency: "UZS", stockOnHand: 5, isActive: false, weightGrams: 300 });
  store.addShippingMethod({ methodId, name: "Tashkent courier", isActive: true, marketCurrency: "UZS", marketActive: true, countries: ["UZ"], rates: [{ minSubtotalMinor: 0, maxWeightGrams: null, priceMinor: 3_000_000, freeOverMinor: null }] });
  return { checkout, status, sandbox, webhook, cron, store, v, soldOut, inactive, methodId };
}

const json = (r: Response) => r.json() as Promise<any>;
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const params = <T>(p: T) => ({ params: Promise.resolve(p) });
const body = (m: Mods, over: Record<string, unknown> = {}) => ({
  email: "qa@dooyoosh.test", locale: "uz", items: [{ variantId: m.v, quantity: 1 }], shippingMethodId: m.methodId,
  shippingAddress: { fullName: "QA", line1: "Amir Temur 1", city: "Tashkent", country: "UZ" }, ...over });
async function create(m: Mods, over: Record<string, unknown> = {}) {
  const r = await m.checkout.POST(post(`${B}/checkout`, body(m, over)));
  return { r, j: await json(r) };
}
const tokenOf = (data: any): string | null => data?.accessToken ?? data?.guestToken ?? (data?.redirectUrl ? new URL(data.redirectUrl).searchParams.get("token") : null);
const statusReq = (id: string, token?: string, query = "") => new Request(`${B}/checkout/${id}/status${query}`, token ? { headers: { authorization: `Bearer ${token}` } } : {});
const sandboxPay = (m: Mods, id: string, token: string | undefined, outcome = "success", query = "") =>
  m.sandbox.POST(post(`${B}/checkout/${id}/sandbox-pay${query}`, token === undefined ? { outcome } : { token, outcome }), params({ checkoutId: id }));
const signMock = (raw: string, t = Math.floor(Date.now() / 1000), secret = SECRET) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
const mockEvent = (co: any, over: Record<string, unknown> = {}) => ({ provider: "mock", eventId: `evt_${randomUUID()}`, type: "payment.succeeded",
  providerPaymentId: `mock_pi_${co.checkoutId}`, amountMinor: co.totals.totalMinor, currency: co.totals.currency, checkoutId: co.checkoutId, ...over });
const sendMock = (m: Mods, raw: string, sig?: string) => m.webhook.POST(post(`${B}/webhooks/mock`, raw, sig ? { "x-mock-signature": sig } : {}), params({ provider: "mock" }));
const ordersFor = (m: Mods, checkoutId: string) => [...m.store.s.orders.values()].filter((o) => o.checkoutId === checkoutId);

describe.skipIf(!HAS_ROUTES)("Payments routes (in-process, memory store)", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  describe("POST /checkout tampering + contract codes", () => {
    let m: Mods;
    beforeEach(async () => { m = await load("mock"); });

    it("201; totals recomputed on server; client price/total fields ignored", async () => {
      const { r, j } = await create(m, { items: [{ variantId: m.v, quantity: 1, unitPriceMinor: 1, priceMinor: 1 }], totalMinor: 1, totals: { totalMinor: 1 }, currency: "USD" });
      expect(r.status, JSON.stringify(j)).toBe(201);
      expect(j.data.totals).toMatchObject({ currency: "UZS", subtotalMinor: 125_000_000, shippingMinor: 3_000_000, totalMinor: 128_000_000 });
    });
    it("reservation 35 min > provider session 30 min", async () => {
      const { j } = await create(m);
      const min = (s: string) => (Date.parse(s) - Date.now()) / 60000;
      expect(min(j.data.reservedUntil)).toBeGreaterThan(34.5);
      expect(min(j.data.expiresAt)).toBeGreaterThan(29.5);
      expect(min(j.data.expiresAt)).toBeLessThan(min(j.data.reservedUntil));
    });
    for (const q of [0, -1, 11, 21, 1.5, "1", null]) {
      it(`quantity ${JSON.stringify(q)} -> 400 VALIDATION_ERROR, stock untouched`, async () => {
        const { r, j } = await create(m, { items: [{ variantId: m.v, quantity: q }] });
        expect(r.status).toBe(400); expect(j.error.code).toBe("VALIDATION_ERROR");
        expect(m.store.stock(m.v).reserved).toBe(0);
      });
    }
    it("duplicate variant lines -> 400 (contract refine), not double reservation", async () => {
      const { r } = await create(m, { items: [{ variantId: m.v, quantity: 2 }, { variantId: m.v, quantity: 2 }] });
      expect(r.status).toBe(400);
      expect(m.store.stock(m.v).reserved).toBe(0);
    });
    it("unknown / sold-out / inactive variant -> 409 OUT_OF_STOCK with details.variantIds", async () => {
      for (const id of [randomUUID(), m.soldOut, m.inactive]) {
        const { r, j } = await create(m, { items: [{ variantId: id, quantity: 1 }] });
        expect(r.status, id).toBe(409); expect(j.error.code).toBe("OUT_OF_STOCK"); expect(j.error.details.variantIds).toEqual([id]);
      }
    });
    it("more than available (4 of 3) -> 409 OUT_OF_STOCK; mixed cart reserves nothing", async () => {
      const { r, j } = await create(m, { items: [{ variantId: m.v, quantity: 4 }] });
      expect(r.status).toBe(409); expect(j.error.details.variantIds).toEqual([m.v]);
      const mixed = await create(m, { items: [{ variantId: m.v, quantity: 1 }, { variantId: m.soldOut, quantity: 1 }] });
      expect(mixed.r.status).toBe(409);
      expect(m.store.stock(m.v).reserved).toBe(0);
    });
    it("expectedUnitPriceMinor mismatch -> 409 PRICE_CHANGED with details.variantIds", async () => {
      const { r, j } = await create(m, { items: [{ variantId: m.v, quantity: 1, expectedUnitPriceMinor: 1 }] });
      expect(r.status).toBe(409); expect(j.error.code).toBe("PRICE_CHANGED"); expect(j.error.details.variantIds).toEqual([m.v]);
    });
    it("non-shippable country -> 422 COUNTRY_NOT_SHIPPABLE; lowercase/invalid ISO -> 400", async () => {
      const a = await create(m, { shippingAddress: { fullName: "QA", line1: "x", city: "y", country: "KP" } });
      expect(a.r.status).toBe(422); expect(a.j.error.code).toBe("COUNTRY_NOT_SHIPPABLE");
      const b = await create(m, { shippingAddress: { fullName: "QA", line1: "x", city: "y", country: "uz" } });
      expect(b.r.status).toBe(400);
    });
    it("unknown shippingMethodId -> 4xx envelope (not 500)", async () => {
      const { r, j } = await create(m, { shippingMethodId: randomUUID() });
      expect(r.status).toBeGreaterThanOrEqual(400); expect(r.status).toBeLessThan(500); expect(j.error.code).toBeTruthy();
    });
    it("invalid JSON -> 400 VALIDATION_ERROR", async () => {
      const r = await m.checkout.POST(post(`${B}/checkout`, "{nope"));
      expect(r.status).toBe(400); expect((await json(r)).error.code).toBe("VALIDATION_ERROR");
    });
    it("same idempotencyKey -> same checkout, same token, reserved once", async () => {
      const key = randomUUID();
      const a = await create(m, { idempotencyKey: key }); const b = await create(m, { idempotencyKey: key });
      expect(b.j.data.checkoutId).toBe(a.j.data.checkoutId);
      expect(tokenOf(b.j.data)).toBe(tokenOf(a.j.data));
      expect([200, 201]).toContain(b.r.status);
      const bad = await create(m, { idempotencyKey: "not-a-uuid" });
      expect(bad.r.status, "idempotencyKey must be a uuid").toBe(400);
      expect(m.store.stock(m.v).reserved).toBe(1);
    });
    it("same idempotencyKey with a DIFFERENT cart must not silently return the old checkout", async () => {
      const key = randomUUID();
      const a = await create(m, { idempotencyKey: key });
      const b = await create(m, { idempotencyKey: key, items: [{ variantId: m.v, quantity: 2 }] });
      // returning a's checkout (1 item) for a 2-item request means the customer pays for a cart they did not submit
      expect(b.r.status, JSON.stringify(b.j)).toBe(409);
      expect(b.j.error.code).toBe("IDEMPOTENCY_CONFLICT");
      expect(m.store.stock(m.v).reserved, "conflicting retry must not reserve").toBe(1);
    });
  });

  describe("GET /checkout/{id}/status + sandbox-pay", () => {
    let m: Mods;
    beforeEach(async () => { m = await load("mock"); });

    it("wrong token / unknown id -> identical 404 NOT_FOUND", async () => {
      const { j } = await create(m);
      const bad = "q".repeat(40);
      const a = await m.status.GET(statusReq(j.data.checkoutId, bad), params({ checkoutId: j.data.checkoutId }));
      const id2 = randomUUID();
      const b = await m.status.GET(statusReq(id2, bad), params({ checkoutId: id2 }));
      const q = await m.status.GET(statusReq(j.data.checkoutId, undefined, `?token=${tokenOf(j.data)}`), params({ checkoutId: j.data.checkoutId }));
      expect(q.status, "?token= in the URL must be refused (400)").toBe(400);
      const none = await m.status.GET(statusReq(j.data.checkoutId), params({ checkoutId: j.data.checkoutId }));
      expect([400, 401, 404]).toContain(none.status);
      expect(a.status).toBe(404); expect(b.status).toBe(404);
      expect(await json(a)).toEqual(await json(b));
    });
    it("response carries data.accessToken (main 12599c0) and the token is NOT in redirectUrl", async () => {
      const { r, j } = await create(m);
      expect(r.status, JSON.stringify(j)).toBe(201);
      expect(typeof j.data.accessToken, "data.accessToken missing; got keys " + Object.keys(j.data)).toBe("string");
      const t = tokenOf(j.data)!;
      expect(j.data.redirectUrl, "guest token must never be put in a URL (provider/third-party Referer + logs)").not.toContain(t);
      expect(j.data.redirectUrl).not.toContain(encodeURIComponent(t));
    });
    it("no guest token in redirectUrl or any URL nested in it (success/cancel/return params)", async () => {
      const { j } = await create(m); const t = tokenOf(j.data)!;
      const urls = [j.data.redirectUrl];
      for (const v of new URL(j.data.redirectUrl).searchParams.values()) if (/^https?:|^\//.test(v)) urls.push(v);
      for (const u of urls) { expect(u).not.toContain(t); expect(decodeURIComponent(u)).not.toContain(t); }
    });
    it("status accepts the token as Authorization: Bearer (contract cfd5cee: token never in a URL)", async () => {
      const { j } = await create(m); const id = j.data.checkoutId; const t = tokenOf(j.data)!;
      const r = await m.status.GET(new Request(`${B}/checkout/${id}/status`, { headers: { authorization: `Bearer ${t}` } }), params({ checkoutId: id }));
      expect(r.status, "status ignores Authorization: Bearer and still needs ?token=").toBe(200);
      const bad = await m.status.GET(new Request(`${B}/checkout/${id}/status`, { headers: { authorization: `Bearer ${"q".repeat(43)}` } }), params({ checkoutId: id }));
      expect(bad.status).toBe(404);
    });
    it("token opens status (and only that checkout)", async () => {
      const a = await create(m); const b = await create(m);
      const ta = tokenOf(a.j.data);
      expect(ta, "redirectUrl has no token").toBeTruthy();
      const ok = await m.status.GET(statusReq(a.j.data.checkoutId, ta!), params({ checkoutId: a.j.data.checkoutId }));
      expect(ok.status).toBe(200);
      const cross = await m.status.GET(statusReq(b.j.data.checkoutId, ta!), params({ checkoutId: b.j.data.checkoutId }));
      expect(cross.status).toBe(404);
    });
    it("sandbox-pay requires the token in the BODY (missing -> 400, in query -> 400, wrong -> 404) and creates no order", async () => {
      const { j } = await create(m); const id = j.data.checkoutId; const t = tokenOf(j.data)!;
      expect((await sandboxPay(m, id, undefined)).status).toBe(400);
      expect((await sandboxPay(m, id, t, "success", `?token=${t}`)).status, "token in query string must be refused").toBe(400);
      expect((await sandboxPay(m, id, "q".repeat(40))).status).toBe(404);
      expect(ordersFor(m, id)).toHaveLength(0);
    });
    it("sandbox-pay with token -> exactly one paid order; repeated -> still one", async () => {
      const { j } = await create(m); const id = j.data.checkoutId; const t = tokenOf(j.data);
      for (let i = 0; i < 3; i++) await sandboxPay(m, id, t!);
      expect(ordersFor(m, id).map((o) => o.status)).toEqual(["paid"]);
      expect(m.store.stock(m.v)).toMatchObject({ onHand: 2, reserved: 0 });
    });
    it("sandbox-pay is refused when PAYMENT_MODE=live", async () => {
      const live = await load("mock", { PAYMENT_MODE: "live" }).catch((e) => e);
      if (live instanceof Error) return; // config refuses mock+live outright: also acceptable
      const { r, j } = await create(live);
      if (r.status !== 201) return; // checkout refused in live mode: acceptable
      const id = j.data.checkoutId; const t = tokenOf(j.data) ?? "q".repeat(40);
      const s = await sandboxPay(live, id, t);
      expect([403, 404]).toContain(s.status);
    });
    it("response-schema failure is a 500 INTERNAL (not a client 400)", async () => {
      const { j } = await create(m); const id = j.data.checkoutId; const t = tokenOf(j.data)!;
      const row = (m.store as any).s.checkouts.get(id); row.status = "qa-not-a-status";
      const r = await m.status.GET(statusReq(id, t), params({ checkoutId: id }));
      expect(r.status).toBe(500);
      const body = await json(r); expect(body.error.code).toBe("INTERNAL");
      expect(JSON.stringify(body)).not.toMatch(/qa-not-a-status|issues|zod/i);
    });
    it("sandbox-pay is a clean 404 when SANDBOX_SIMULATOR_ENABLED is not 'true' (gate closed), never 500", async () => {
      for (const extra of [{ SANDBOX_SIMULATOR_ENABLED: "false" }, { SANDBOX_SIMULATOR_ENABLED: "" }, { PAYMENT_MODE: "live", NEXT_PUBLIC_PAYMENT_MODE: "live", SANDBOX_SIMULATOR_ENABLED: "true" }]) {
        const g = await load("mock", extra).catch((e) => e);
        if (g instanceof Error) continue;
        const id = randomUUID();
        expect((await sandboxPay(g, id, "q".repeat(43))).status, JSON.stringify(extra)).toBe(404);
      }
    })
  });

  describe("mock webhook signatures + idempotency", () => {
    let m: Mods;
    beforeEach(async () => { m = await load("mock"); });

    it("missing / malformed / wrong-secret signature -> 401", async () => {
      const raw = JSON.stringify({ a: 1 });
      for (const sig of [undefined, "garbage", "t=1,v1=zz", signMock(raw, undefined, "wrong-secret")]) expect((await sendMock(m, raw, sig)).status, String(sig)).toBe(401);
    });
    it("timestamp tolerance: 299 s old accepted, 301 s old and 301 s in the future rejected", async () => {
      const { j } = await create(m);
      const now = Math.floor(Date.now() / 1000);
      const mk = () => JSON.stringify(mockEvent(j.data));
      const old = mk(); expect((await sendMock(m, old, signMock(old, now - 301))).status).toBe(401);
      const fut = mk(); expect((await sendMock(m, fut, signMock(fut, now + 301))).status).toBe(401);
      const ok = mk(); expect((await sendMock(m, ok, signMock(ok, now - 299))).status).toBe(200);
    });
    it("body changed after signing -> 401 (raw-body verification)", async () => {
      const { j } = await create(m);
      const raw = JSON.stringify(mockEvent(j.data)); const sig = signMock(raw);
      expect((await sendMock(m, raw.replace(String(j.data.totals.totalMinor), "1"), sig)).status).toBe(401);
    });
    it("pretty-printed body signed as sent -> 200 (no re-serialisation before verify)", async () => {
      const { j } = await create(m);
      const raw = JSON.stringify(mockEvent(j.data), null, 2) + "\n";
      expect((await sendMock(m, raw, signMock(raw))).status).toBe(200);
      expect(ordersFor(m, j.data.checkoutId)).toHaveLength(1);
    });
    it("same event replayed 5x (concurrently) -> exactly one order, one sale movement", async () => {
      const { j } = await create(m);
      const raw = JSON.stringify(mockEvent(j.data));
      const rs = await Promise.all(Array.from({ length: 5 }, () => sendMock(m, raw, signMock(raw))));
      expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(ordersFor(m, j.data.checkoutId)).toHaveLength(1);
      expect(m.store.s.movements.filter((x) => x.variantId === m.v && x.reason === "sale")).toHaveLength(1);
    });
    it("different eventIds for the same payment -> still one order", async () => {
      const { j } = await create(m);
      for (let i = 0; i < 3; i++) { const raw = JSON.stringify(mockEvent(j.data)); await sendMock(m, raw, signMock(raw)); }
      expect(ordersFor(m, j.data.checkoutId)).toHaveLength(1);
      expect(m.store.stock(m.v).onHand).toBe(2);
    });
    it("amount -1 / currency / provider mismatch -> no order", async () => {
      const { j } = await create(m);
      for (const over of [{ amountMinor: j.data.totals.totalMinor - 1 }, { currency: "USD" }, { amountMinor: 0 }]) {
        const raw = JSON.stringify(mockEvent(j.data, over)); const r = await sendMock(m, raw, signMock(raw));
        expect(r.status).toBeLessThan(500);
      }
      expect(ordersFor(m, j.data.checkoutId)).toHaveLength(0);
    });
    it("payment.failed after paid does not cancel the order or release stock twice", async () => {
      const { j } = await create(m);
      const ok = JSON.stringify(mockEvent(j.data)); await sendMock(m, ok, signMock(ok));
      const fail = JSON.stringify(mockEvent(j.data, { type: "payment.failed" })); await sendMock(m, fail, signMock(fail));
      expect(ordersFor(m, j.data.checkoutId).map((o) => o.status)).toEqual(["paid"]);
      expect(m.store.stock(m.v)).toMatchObject({ onHand: 2, reserved: 0 });
    });
    it("late success after 35-min reservation expiry + cron -> 200, order stock_conflict, other buyer keeps the unit", async () => {
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date());
      const one = await load("mock"); // fresh store
      const a = await create(one, { items: [{ variantId: one.v, quantity: 3 }] });
      vi.setSystemTime(Date.now() + 36 * 60_000);
      const c = await one.cron.POST(new Request(`${B}/cron/release-expired`, { method: "POST", headers: { authorization: `Bearer ${CRON}` } }));
      expect(c.status).toBe(200);
      const b = await create(one, { items: [{ variantId: one.v, quantity: 3 }] });
      expect(b.r.status).toBe(201);
      const raw = JSON.stringify(mockEvent(a.j.data));
      const r = await sendMock(one, raw, signMock(raw));
      expect(r.status).toBe(200);
      // spec v0.2: stock_conflict + auto-refund; mock refunds synchronously so 'refunded' is the settled state
      expect(ordersFor(one, a.j.data.checkoutId).map((o) => o.status)).toEqual([expect.stringMatching(/^(stock_conflict|refunded)$/)]);
      expect(one.store.stock(one.v)).toMatchObject({ onHand: 3, reserved: 3 });
    });
  });

  describe("cron", () => {
    it("no / wrong / prefix-only bearer -> 401; correct -> 200", async () => {
      const m = await load("mock");
      for (const h of [{}, { authorization: "Bearer nope" }, { authorization: `Bearer ${CRON}x` }, { authorization: CRON }, { authorization: `bearer ${CRON}` }]) {
        const r = await m.cron.POST(new Request(`${B}/cron/release-expired`, { method: "POST", headers: h }));
        expect(r.status, JSON.stringify(h)).toBe(401);
      }
      const ok = await m.cron.POST(new Request(`${B}/cron/release-expired`, { method: "POST", headers: { authorization: `Bearer ${CRON}` } }));
      expect(ok.status).toBe(200);
    });
    it("weak CRON_SECRET (<16 chars) never authorises", async () => {
      const m = await load("mock", { CRON_SECRET: "short" });
      const r = await m.cron.POST(new Request(`${B}/cron/release-expired`, { method: "POST", headers: { authorization: "Bearer short" } }));
      expect(r.status).toBe(401);
    });
  });

  describe("Payme JSON-RPC", () => {
    let m: Mods;
    const basic = (k = PAYME_KEY, login = "Paycom") => "Basic " + Buffer.from(`${login}:${k}`).toString("base64");
    const rpc = async (method: string, p: unknown, auth?: string) => {
      const r = await m.webhook.POST(post(`${B}/webhooks/payme`, { jsonrpc: "2.0", id: 1, method, params: p }, auth ? { authorization: auth } : {}), params({ provider: "payme" }));
      return { status: r.status, j: await json(r) };
    };
    beforeEach(async () => { m = await load("payme"); });

    it("no / wrong / malformed auth -> HTTP 200 + -32504", async () => {
      const { j } = await create(m);
      for (const a of [undefined, basic("wrong"), basic(PAYME_KEY, "Evil"), "Basic !!!", `Bearer ${PAYME_KEY}`]) {
        const r = await rpc("CheckPerformTransaction", { amount: j.data.totals.totalMinor, account: { order_id: j.data.checkoutId } }, a);
        expect(r.status).toBe(200); expect(r.j.error?.code, String(a)).toBe(-32504);
      }
    });
    it("amount mismatch (±1 tiyin) -> -31001; unknown account -> -31050..-31099", async () => {
      const { j } = await create(m);
      for (const amount of [j.data.totals.totalMinor - 1, j.data.totals.totalMinor + 1]) {
        expect((await rpc("CheckPerformTransaction", { amount, account: { order_id: j.data.checkoutId } }, basic())).j.error?.code).toBe(-31001);
      }
      const u = (await rpc("CheckPerformTransaction", { amount: 100, account: { order_id: randomUUID() } }, basic())).j.error?.code;
      expect(u).toBeLessThanOrEqual(-31050); expect(u).toBeGreaterThanOrEqual(-31099);
    });
    it("Create -> Perform -> Perform(replay) -> Cancel: one order, state 2 then -2, stock restored with 'return' movement", async () => {
      const { j } = await create(m);
      const amount = j.data.totals.totalMinor, account = { order_id: j.data.checkoutId }, id = "qa" + Date.now();
      expect((await rpc("CheckPerformTransaction", { amount, account }, basic())).j.result?.allow).toBe(true);
      const c1 = await rpc("CreateTransaction", { id, time: Date.now(), amount, account }, basic());
      const c2 = await rpc("CreateTransaction", { id, time: Date.now(), amount, account }, basic());
      expect(c1.j.result.state).toBe(1); expect(c2.j.result.transaction).toBe(c1.j.result.transaction);
      const p1 = await rpc("PerformTransaction", { id }, basic()); const p2 = await rpc("PerformTransaction", { id }, basic());
      expect(p1.j.result.state).toBe(2); expect(p2.j.result.perform_time).toBe(p1.j.result.perform_time);
      expect(ordersFor(m, j.data.checkoutId)).toHaveLength(1);
      expect(m.store.stock(m.v).onHand).toBe(2);
      const cancel = await rpc("CancelTransaction", { id, reason: 5 }, basic());
      expect(cancel.j.result?.state).toBe(-2);
      expect(m.store.stock(m.v).onHand).toBe(3);
      expect(m.store.s.movements.some((x) => x.variantId === m.v && x.reason === "return" && x.delta === 1)).toBe(true);
      const cancel2 = await rpc("CancelTransaction", { id, reason: 5 }, basic());
      expect(cancel2.j.result?.state).toBe(-2);
      expect(m.store.stock(m.v).onHand, "second Cancel must not restock twice").toBe(3);
    });
    it("Perform after the 35-min reservation expired -> error (-31008), no order", async () => {
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date());
      m = await load("payme");
      const { j } = await create(m);
      const amount = j.data.totals.totalMinor, account = { order_id: j.data.checkoutId }, id = "exp" + Date.now();
      await rpc("CreateTransaction", { id, time: Date.now(), amount, account }, basic());
      vi.setSystemTime(Date.now() + 36 * 60_000);
      const p = await rpc("PerformTransaction", { id }, basic());
      expect(p.j.error?.code).toBe(-31008);
      expect(ordersFor(m, j.data.checkoutId)).toHaveLength(0);
    });
    it("second Payme transaction for the same checkout while one is open -> -31008 / -3105x", async () => {
      const { j } = await create(m);
      const amount = j.data.totals.totalMinor, account = { order_id: j.data.checkoutId };
      await rpc("CreateTransaction", { id: "a" + Date.now(), time: Date.now(), amount, account }, basic());
      const b = await rpc("CreateTransaction", { id: "b" + Date.now(), time: Date.now(), amount, account }, basic());
      expect(b.j.error?.code).toBeLessThan(-31000);
    });
    it("invalid JSON -> HTTP 200 with -32700", async () => {
      const r = await m.webhook.POST(post(`${B}/webhooks/payme`, "{bad", { authorization: basic() }), params({ provider: "payme" }));
      expect(r.status).toBe(200); expect((await json(r)).error?.code).toBe(-32700);
    });
  });

  describe("Click Prepare/Complete", () => {
    let m: Mods;
    const md5 = (s: string) => createHash("md5").update(s).digest("hex");
    const t = () => new Date().toISOString().replace("T", " ").slice(0, 19);
    const send = async (o: Record<string, string | number>) => {
      const r = await m.webhook.POST(new Request(`${B}/webhooks/click`, { method: "POST", body: new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } }), params({ provider: "click" }));
      return { status: r.status, j: await json(r) };
    };
    const prepare = (co: string, amount: string, trans: number, secret = CLICK_SECRET) => {
      const st = t();
      return { click_trans_id: trans, service_id: "123", click_paydoc_id: trans, merchant_trans_id: co, amount, action: 0, error: 0, error_note: "Success", sign_time: st, sign_string: md5(`${trans}123${secret}${co}${amount}0${st}`) };
    };
    const complete = (co: string, prep: string, amount: string, trans: number, err = 0) => {
      const st = t();
      return { click_trans_id: trans, service_id: "123", click_paydoc_id: trans, merchant_trans_id: co, merchant_prepare_id: prep, amount, action: 1, error: err, error_note: "Success", sign_time: st, sign_string: md5(`${trans}123${CLICK_SECRET}${co}${prep}${amount}1${st}`) };
    };
    const soum = (minor: number) => (minor / 100).toFixed(2);
    beforeEach(async () => { m = await load("click"); });

    it("bad sign_string -> HTTP 200 error -1, no state change", async () => {
      const { j } = await create(m);
      const r = await send(prepare(j.data.checkoutId, soum(j.data.totals.totalMinor), Date.now(), "wrong"));
      expect(r.status).toBe(200); expect(Number(r.j.error)).toBe(-1);
    });
    it("wrong amount -> -2; unknown merchant_trans_id -> -5/-6", async () => {
      const { j } = await create(m);
      expect(Number((await send(prepare(j.data.checkoutId, soum(j.data.totals.totalMinor + 100), Date.now()))).j.error)).toBe(-2);
      expect([-5, -6]).toContain(Number((await send(prepare(randomUUID(), "1000.00", Date.now()))).j.error));
    });
    it("Prepare -> Complete -> Complete(replay): one order; replay -4 or same success", async () => {
      const { j } = await create(m); const tr = Date.now(); const amt = soum(j.data.totals.totalMinor);
      const p = await send(prepare(j.data.checkoutId, amt, tr)); expect(Number(p.j.error)).toBe(0);
      const c1 = await send(complete(j.data.checkoutId, String(p.j.merchant_prepare_id), amt, tr)); expect(Number(c1.j.error)).toBe(0);
      const c2 = await send(complete(j.data.checkoutId, String(p.j.merchant_prepare_id), amt, tr)); expect([0, -4]).toContain(Number(c2.j.error));
      expect(ordersFor(m, j.data.checkoutId)).toHaveLength(1);
    });
    it("Complete with a merchant_prepare_id from another checkout -> error, no order", async () => {
      const a = await create(m); const b = await create(m); const tr = Date.now();
      const amtA = soum(a.j.data.totals.totalMinor);
      const p = await send(prepare(a.j.data.checkoutId, amtA, tr));
      const c = await send(complete(b.j.data.checkoutId, String(p.j.merchant_prepare_id), soum(b.j.data.totals.totalMinor), tr));
      expect(Number(c.j.error)).toBeLessThan(0);
      expect(ordersFor(m, b.j.data.checkoutId)).toHaveLength(0);
    });
    it("Complete after reservation expiry -> error, no order", async () => {
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date());
      m = await load("click");
      const { j } = await create(m); const tr = Date.now(); const amt = soum(j.data.totals.totalMinor);
      const p = await send(prepare(j.data.checkoutId, amt, tr));
      vi.setSystemTime(Date.now() + 36 * 60_000);
      const c = await send(complete(j.data.checkoutId, String(p.j.merchant_prepare_id), amt, tr));
      expect(Number(c.j.error)).toBeLessThan(0);
      expect(ordersFor(m, j.data.checkoutId).filter((o) => o.status === "paid")).toHaveLength(0);
    });
  });

  describe("ADMIN_DEV_TOKEN + guest order lookup", () => {
    const DEV = "qa_admin_dev_token_0123456789abcdef0123";
    const HAS_ADMIN = fs.existsSync(path.join(ROOT, "src/app/api/v1/admin/orders/route.ts"));
    const adminGet = async (extra: Record<string, string>) => {
      const m = await load("mock", { ADMIN_DEV_TOKEN: DEV, ...extra }).catch((e) => e);
      if (m instanceof Error) return { refusedAtBoot: true, status: 0 };
      const route = await import("@/app/api/v1/admin/orders/route");
      const r = await route.GET(new Request(`${B}/admin/orders`, { headers: { authorization: `Bearer ${DEV}` } }));
      return { refusedAtBoot: false, status: r.status };
    };
    it.skipIf(!HAS_ADMIN)("dev token grants admin in development+memory (sanity)", async () => {
      expect((await adminGet({ NODE_ENV: "development" })).status).toBe(200);
    });
    it.skipIf(!HAS_ADMIN)("dev token is ignored when NODE_ENV=production (P0 if it grants admin)", async () => {
      const r = await adminGet({ NODE_ENV: "production", ALLOW_MOCK_IN_PRODUCTION: "true" });
      if (!r.refusedAtBoot) expect(r.status).toBe(401);
    });
    it.skipIf(!HAS_ADMIN)("dev token is ignored when PAYMENT_MODE=live", async () => {
      const r = await adminGet({ NODE_ENV: "development", PAYMENT_MODE: "live", NEXT_PUBLIC_PAYMENT_MODE: "live" });
      if (!r.refusedAtBoot) expect(r.status).toBe(401);
    });
    it.skipIf(!HAS_ADMIN)("wrong / prefix / lowercase-bearer dev token -> 401", async () => {
      const m = await load("mock", { ADMIN_DEV_TOKEN: DEV, NODE_ENV: "development" });
      const route = await import("@/app/api/v1/admin/orders/route");
      for (const h of [`Bearer ${DEV}x`, `Bearer ${DEV.slice(0, -1)}`, `bearer ${DEV}`, DEV, ""]) {
        expect((await route.GET(new Request(`${B}/admin/orders`, { headers: { authorization: h } }))).status, h).toBe(401);
      }
      void m;
    });
    it("GET /orders/{ref}: Bearer only (?token= -> 400); right token 200, wrong / other order's token 404", async (ctx) => {
      if (!fs.existsSync(path.join(ROOT, "src/app/api/v1/orders/[reference]/route.ts"))) ctx.skip();
      const m = await load("mock");
      const orders = await import("@/app/api/v1/orders/[reference]/route");
      const pay = async () => {
        const { j } = await create(m); const t = tokenOf(j.data)!;
        await sandboxPay(m, j.data.checkoutId, t);
        const st = await json(await m.status.GET(statusReq(j.data.checkoutId, t), params({ checkoutId: j.data.checkoutId })));
        return { ref: st.data.orderReference as string, t };
      };
      const a = await pay(); const b = await pay();
      expect(a.ref).toBeTruthy();
      const q = (ref: string, tok: string) => orders.GET(new Request(`${B}/orders/${ref}`, { headers: { authorization: `Bearer ${tok}` } }), params({ reference: ref }));
      const inQuery = await orders.GET(new Request(`${B}/orders/${a.ref}?token=${a.t}`), params({ reference: a.ref }));
      expect(inQuery.status, "/orders/{ref}?token= must be refused (400)").toBe(400);
      expect((await q(a.ref, a.t)).status).toBe(200);
      expect((await q(a.ref, "q".repeat(43))).status).toBe(404);
      expect((await q(a.ref, b.t)).status, "token of another order must not open this one").toBe(404);
      const bearer = await orders.GET(new Request(`${B}/orders/${a.ref}`, { headers: { authorization: `Bearer ${a.t}` } }), params({ reference: a.ref }));
      expect(bearer.status, "orders/{ref} only reads ?token= (contradicts cfd5cee: token never in a URL)").toBe(200);
    });
  });

  it("webhook for a provider that is not enabled -> 404, unknown provider -> 400", async () => {
    const m = await load("mock");
    const a = await m.webhook.POST(post(`${B}/webhooks/payme`, "{}"), params({ provider: "payme" }));
    expect(a.status).toBe(404);
    const b = await m.webhook.POST(post(`${B}/webhooks/paypal`, "{}"), params({ provider: "paypal" }));
    expect(b.status).toBe(400);
  });
});
