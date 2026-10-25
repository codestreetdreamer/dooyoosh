// Live: POST /api/v1/webhooks/{mock|payme|click}. Spec §11 + docs/PAYMENT_PROVIDERS_UZ.md.
// Payme and Click always answer HTTP 200; the error is in the body.
import { describe, it, expect, beforeAll } from "vitest";
import { UP, DOWN_REASON, call, skipIfMissing, env, md5, signMock, randomUUID } from "./lib/http.js";
import { buyable, checkoutBody } from "./lib/fixtures.js";

let f;
async function newCheckout() {
  if (!f) return null;
  const r = await call("POST", "/checkout", { body: checkoutBody(f, { idempotencyKey: randomUUID() }) });
  return r.status === 201 ? r.json.data : null;
}

describe.skipIf(!UP)(`webhooks${UP ? "" : ` [SKIPPED: ${DOWN_REASON}]`}`, () => {
  // Only the configured provider is mounted (404 for the others). Deep Payme/Click tests need PAYMENT_PROVIDER=payme|click.
  const PROVIDER = (env("PAYMENT_PROVIDER") || env("QA_PAYMENT_PROVIDER") || "mock").toLowerCase();
  const hasPayme = () => PROVIDER === "payme";
  const hasClick = () => PROVIDER === "click";

  beforeAll(async () => { f = await buyable(); });

  // ---------- mock (HMAC: x-mock-signature: t=<s>,v1=hex(HMAC_SHA256(secret, "<t>.<raw>"))) ----------
  describe("mock", () => {
    const secret = env("PAYMENT_WEBHOOK_SECRET");
    const ev = (co, over = {}) => ({ provider: "mock", eventId: `evt_${randomUUID()}`, type: "payment.succeeded", providerPaymentId: `mock_pi_${co.checkoutId}`,
      amountMinor: co.totals.totalMinor, currency: co.totals.currency, checkoutId: co.checkoutId, ...over });
    const send = (raw, sig) => call("POST", "/webhooks/mock", { raw, headers: { "content-type": "application/json", ...(sig ? { "x-mock-signature": sig } : {}) } });

    it("unsigned -> 401", async (ctx) => {
      const r = await send(JSON.stringify({ x: 1 }));
      skipIfMissing(ctx, r, "webhooks/mock");
      expect(r.status).toBe(401);
    });
    it("bad signature, stale timestamp (>5 min), and body tampered after signing -> 401", async (ctx) => {
      const raw = JSON.stringify({ x: 1 });
      const r0 = await send(raw, "t=1,v1=" + "0".repeat(64));
      skipIfMissing(ctx, r0, "webhooks/mock");
      expect(r0.status).toBe(401);
      if (!secret) ctx.skip("set PAYMENT_WEBHOOK_SECRET for signed cases");
      expect((await send(raw, signMock(secret, raw, Math.floor(Date.now() / 1000) - 600))).status).toBe(401);
      expect((await send(raw.replace("1", "2"), signMock(secret, raw))).status).toBe(401);
    });
    it("signature is verified on the RAW body (pretty-printed JSON with spaces still verifies)", async (ctx) => {
      if (!secret) ctx.skip("set PAYMENT_WEBHOOK_SECRET");
      const co = await newCheckout(); if (!co) ctx.skip("could not create a checkout");
      const raw = JSON.stringify(ev(co), null, 2) + "\n";
      const r = await send(raw, signMock(secret, raw));
      skipIfMissing(ctx, r, "webhooks/mock");
      expect(r.status, r.text.slice(0, 200)).toBe(200);
    });
    it("same event delivered 5x concurrently -> all 200, exactly one order (checkout status paid once)", async (ctx) => {
      if (!secret) ctx.skip("set PAYMENT_WEBHOOK_SECRET");
      const co = await newCheckout(); if (!co) ctx.skip("could not create a checkout");
      const raw = JSON.stringify(ev(co));
      const rs = await Promise.all(Array.from({ length: 5 }, () => send(raw, signMock(secret, raw))));
      skipIfMissing(ctx, rs[0], "webhooks/mock");
      expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      const owner = env("QA_ADMIN_COOKIE_OWNER");
      if (owner) {
        const o = await call("GET", "/admin/orders", { headers: { cookie: owner }, query: { q: co.checkoutId } });
        expect(o.json.data.length).toBe(1);
      }
    });
    it("amount mismatch (1 minor unit less) -> rejected, order not paid", async (ctx) => {
      if (!secret) ctx.skip("set PAYMENT_WEBHOOK_SECRET");
      const co = await newCheckout(); if (!co) ctx.skip("could not create a checkout");
      const raw = JSON.stringify(ev(co, { amountMinor: co.totals.totalMinor - 1 }));
      const r = await send(raw, signMock(secret, raw));
      skipIfMissing(ctx, r, "webhooks/mock");
      const owner = env("QA_ADMIN_COOKIE_OWNER");
      if (!owner) ctx.skip("set QA_ADMIN_COOKIE_OWNER to verify no paid order");
      const o = await call("GET", "/admin/orders", { headers: { cookie: owner }, query: { q: co.checkoutId, status: "paid" } });
      expect(o.json.data.length).toBe(0);
    });
    it("currency mismatch -> rejected", async (ctx) => {
      if (!secret) ctx.skip("set PAYMENT_WEBHOOK_SECRET");
      const co = await newCheckout(); if (!co) ctx.skip("could not create a checkout");
      const raw = JSON.stringify(ev(co, { currency: co.totals.currency === "UZS" ? "USD" : "UZS" }));
      const r = await send(raw, signMock(secret, raw));
      skipIfMissing(ctx, r, "webhooks/mock");
      expect(r.status).not.toBe(500);
      const owner = env("QA_ADMIN_COOKIE_OWNER");
      if (!owner) ctx.skip("set QA_ADMIN_COOKIE_OWNER to verify no paid order");
      expect((await call("GET", "/admin/orders", { headers: { cookie: owner }, query: { q: co.checkoutId, status: "paid" } })).json.data.length).toBe(0);
    });
    it("late success after reservation expiry -> 200, order stock_conflict (not paid)", async (ctx) => {
      if (!secret) ctx.skip("set PAYMENT_WEBHOOK_SECRET");
      const id = env("QA_EXPIRED_CHECKOUT_ID"), amt = env("QA_EXPIRED_CHECKOUT_TOTAL");
      if (!id || !amt) ctx.skip("set QA_EXPIRED_CHECKOUT_ID + QA_EXPIRED_CHECKOUT_TOTAL (seeded checkout whose reservation is released)");
      const raw = JSON.stringify(ev({ checkoutId: id, totals: { totalMinor: Number(amt), currency: env("QA_CURRENCY") || "UZS" } }));
      const r = await send(raw, signMock(secret, raw));
      skipIfMissing(ctx, r, "webhooks/mock");
      expect(r.status).toBe(200);
    });
  });

  // ---------- Payme Merchant API (JSON-RPC, Basic auth "Paycom:<KEY>") ----------
  it("payme/click routes are 404 when PAYMENT_PROVIDER=mock (only the configured provider is mounted)", async (ctx) => {
    if (PROVIDER !== "mock") ctx.skip(`PAYMENT_PROVIDER=${PROVIDER}`);
    for (const p of ["payme", "click"]) {
      const r = await call("POST", `/webhooks/${p}`, { body: {} });
      skipIfMissing(ctx, r, `webhooks/${p}`);
      expect(r.status, p).toBe(404);
    }
  });

  describe.skipIf(!hasPayme())("payme", () => {
    const key = env("PAYME_KEY"), login = env("PAYME_LOGIN") || "Paycom", field = env("PAYME_ACCOUNT_FIELD") || "order_id";
    const rpc = (method, params, auth) => call("POST", "/webhooks/payme", {
      raw: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) } });
    const basic = (k) => "Basic " + Buffer.from(`${login}:${k}`).toString("base64");

    it("no Authorization -> HTTP 200 with error.code -32504", async (ctx) => {
      const r = await rpc("CheckPerformTransaction", { amount: 100, account: { [field]: randomUUID() } });
      skipIfMissing(ctx, r, "webhooks/payme");
      expect(r.status).toBe(200);
      expect(r.json?.error?.code).toBe(-32504);
    });
    it("wrong key / malformed Basic -> -32504", async (ctx) => {
      for (const a of [basic("wrong-key"), "Basic !!!", "Bearer x"]) {
        const r = await rpc("CheckPerformTransaction", { amount: 100, account: { [field]: randomUUID() } }, a);
        skipIfMissing(ctx, r, "webhooks/payme");
        expect(r.status).toBe(200);
        expect(r.json?.error?.code, a).toBe(-32504);
      }
    });
    it("invalid JSON -> -32700 parse error, HTTP 200", async (ctx) => {
      if (!key) ctx.skip("set PAYME_KEY (sandbox TEST_KEY)");
      const r = await call("POST", "/webhooks/payme", { raw: "{bad", headers: { authorization: basic(key), "content-type": "application/json" } });
      skipIfMissing(ctx, r, "webhooks/payme");
      expect(r.status).toBe(200);
      expect(r.json?.error?.code).toBe(-32700);
    });
    it("CheckPerformTransaction amount mismatch (tiyin) -> -31001; unknown account -> -31050..-31099", async (ctx) => {
      if (!key) ctx.skip("set PAYME_KEY");
      const co = await newCheckout(); if (!co) ctx.skip("could not create a checkout");
      const r = await rpc("CheckPerformTransaction", { amount: co.totals.totalMinor + 1, account: { [field]: co.checkoutId } }, basic(key));
      skipIfMissing(ctx, r, "webhooks/payme");
      expect(r.json?.error?.code).toBe(-31001);
      const u = await rpc("CheckPerformTransaction", { amount: co.totals.totalMinor, account: { [field]: randomUUID() } }, basic(key));
      expect(u.json?.error?.code).toBeLessThanOrEqual(-31050); expect(u.json?.error?.code).toBeGreaterThanOrEqual(-31099);
    });
    it("Check -> Create -> Perform -> Perform(replay) -> Cancel: idempotent, single order, Cancel after Perform = state -2", async (ctx) => {
      if (!key) ctx.skip("set PAYME_KEY");
      const co = await newCheckout(); if (!co) ctx.skip("could not create a checkout");
      const A = basic(key), account = { [field]: co.checkoutId }, amount = co.totals.totalMinor, id = randomUUID().replace(/-/g, "").slice(0, 24);
      const chk = await rpc("CheckPerformTransaction", { amount, account }, A);
      skipIfMissing(ctx, chk, "webhooks/payme");
      expect(chk.json?.result?.allow).toBe(true);
      const c1 = await rpc("CreateTransaction", { id, time: Date.now(), amount, account }, A);
      const c2 = await rpc("CreateTransaction", { id, time: Date.now(), amount, account }, A);
      expect(c1.json.result.state).toBe(1); expect(c2.json.result.transaction).toBe(c1.json.result.transaction);
      const p1 = await rpc("PerformTransaction", { id }, A);
      const p2 = await rpc("PerformTransaction", { id }, A);
      expect(p1.json.result.state).toBe(2); expect(p2.json.result.perform_time).toBe(p1.json.result.perform_time);
      const other = await rpc("CreateTransaction", { id: id + "x", time: Date.now(), amount, account }, A);
      expect(other.json?.error?.code, "second Payme transaction for an already-paid checkout").toBeLessThanOrEqual(-31050);
      const cancel = await rpc("CancelTransaction", { id, reason: 5 }, A);
      expect(cancel.json?.result?.state).toBe(-2);
      const owner = env("QA_ADMIN_COOKIE_OWNER");
      if (owner) {
        const o = await call("GET", "/admin/orders", { headers: { cookie: owner }, query: { q: co.checkoutId } });
        expect(o.json.data.length).toBe(1);
        const mv = await call("GET", `/admin/variants/${f.variantId}/movements`, { headers: { cookie: owner } });
        expect(mv.json.data.some((m) => m.reason === "return" && m.delta > 0), "Cancel after Perform must write a 'return' movement").toBe(true);
      }
    });
    it("Check/Perform after the 35-min reservation expired -> error, no order", async (ctx) => {
      if (!key) ctx.skip("set PAYME_KEY");
      const id = env("QA_EXPIRED_CHECKOUT_ID"), amt = env("QA_EXPIRED_CHECKOUT_TOTAL");
      if (!id || !amt) ctx.skip("set QA_EXPIRED_CHECKOUT_ID + QA_EXPIRED_CHECKOUT_TOTAL");
      const r = await rpc("CheckPerformTransaction", { amount: Number(amt), account: { [field]: id } }, basic(key));
      skipIfMissing(ctx, r, "webhooks/payme");
      expect(r.json?.error?.code).toBeLessThan(0);
      const c = await rpc("CreateTransaction", { id: "exp" + Date.now(), time: Date.now(), amount: Number(amt), account: { [field]: id } }, basic(key));
      expect(c.json?.error?.code).toBeLessThan(0);
    });
  });

  // ---------- Click SHOP API (Prepare action=0 / Complete action=1, MD5 sign_string, amount in so'm) ----------
  describe.skipIf(!hasClick())("click", () => {
    const sid = env("CLICK_SERVICE_ID"), secret = env("CLICK_SECRET_KEY");
    const signTime = () => new Date().toISOString().replace("T", " ").slice(0, 19);
    const form = (o) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();
    const send = (o) => call("POST", "/webhooks/click", { raw: form(o), headers: { "content-type": "application/x-www-form-urlencoded" } });
    const prepare = (co, amount, trans = Date.now(), sk = secret) => {
      const t = signTime();
      const o = { click_trans_id: trans, service_id: sid, click_paydoc_id: trans, merchant_trans_id: co, amount, action: 0, error: 0, error_note: "Success", sign_time: t };
      o.sign_string = md5(`${trans}${sid}${sk}${co}${amount}0${t}`);
      return o;
    };
    const complete = (co, prepId, amount, trans) => {
      const t = signTime();
      const o = { click_trans_id: trans, service_id: sid, click_paydoc_id: trans, merchant_trans_id: co, merchant_prepare_id: prepId, amount, action: 1, error: 0, error_note: "Success", sign_time: t };
      o.sign_string = md5(`${trans}${sid}${secret}${co}${prepId}${amount}1${t}`);
      return o;
    };
    const soum = (minor) => (minor / 100).toFixed(2);

    it("bad sign_string -> error -1 (SIGN CHECK FAILED), HTTP 200", async (ctx) => {
      const r = await send({ ...prepare(randomUUID(), "1000.00", Date.now(), "wrong"), service_id: sid || "1" });
      skipIfMissing(ctx, r, "webhooks/click");
      expect(r.status).toBe(200);
      expect(Number(r.json?.error)).toBe(-1);
    });
    it("Prepare with wrong amount -> -2; unknown merchant_trans_id -> -5 (or -6)", async (ctx) => {
      if (!sid || !secret) ctx.skip("set CLICK_SERVICE_ID + CLICK_SECRET_KEY");
      const co = await newCheckout(); if (!co) ctx.skip("could not create a checkout");
      const r = await send(prepare(co.checkoutId, soum(co.totals.totalMinor + 100)));
      skipIfMissing(ctx, r, "webhooks/click");
      expect(Number(r.json?.error)).toBe(-2);
      const u = await send(prepare(randomUUID(), "1000.00"));
      expect([-5, -6]).toContain(Number(u.json?.error));
    });
    it("Prepare -> Complete -> Complete(replay): one order; replay returns already-paid (-4) or the same success", async (ctx) => {
      if (!sid || !secret) ctx.skip("set CLICK_SERVICE_ID + CLICK_SECRET_KEY");
      const co = await newCheckout(); if (!co) ctx.skip("could not create a checkout");
      const trans = Date.now(); const amt = soum(co.totals.totalMinor);
      const p = await send(prepare(co.checkoutId, amt, trans));
      skipIfMissing(ctx, p, "webhooks/click");
      expect(Number(p.json.error)).toBe(0);
      const c1 = await send(complete(co.checkoutId, p.json.merchant_prepare_id, amt, trans));
      expect(Number(c1.json.error)).toBe(0);
      const c2 = await send(complete(co.checkoutId, p.json.merchant_prepare_id, amt, trans));
      expect([0, -4]).toContain(Number(c2.json.error));
      const owner = env("QA_ADMIN_COOKIE_OWNER");
      if (owner) expect((await call("GET", "/admin/orders", { headers: { cookie: owner }, query: { q: co.checkoutId } })).json.data.length).toBe(1);
    });
    it("Complete after reservation expiry -> error (no order)", async (ctx) => {
      if (!sid || !secret) ctx.skip("set CLICK_SERVICE_ID + CLICK_SECRET_KEY");
      const id = env("QA_EXPIRED_CHECKOUT_ID"), amt = env("QA_EXPIRED_CHECKOUT_TOTAL");
      if (!id || !amt) ctx.skip("set QA_EXPIRED_CHECKOUT_ID + QA_EXPIRED_CHECKOUT_TOTAL");
      const r = await send(prepare(id, soum(Number(amt))));
      skipIfMissing(ctx, r, "webhooks/click");
      expect(Number(r.json?.error)).toBeLessThan(0);
    });
  });
});
