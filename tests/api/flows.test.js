// Live: guest order access (Bearer only), success page never marks paid.
import { describe, it, expect, beforeAll } from "vitest";
import { UP, DOWN_REASON, call, skipIfMissing, expectEnvelope, env, SITE_URL, randomUUID } from "./lib/http.js";
import { buyable, checkoutBody } from "./lib/fixtures.js";

const TOKEN = "q".repeat(43);
const bearer = (t) => ({ authorization: `Bearer ${t}` });
describe.skipIf(!UP)(`guest access + success page${UP ? "" : ` [SKIPPED: ${DOWN_REASON}]`}`, () => {
  let f; beforeAll(async () => { f = await buyable(); });

  it("GET /orders/{unknown ref} with Bearer -> 404 NOT_FOUND", async (ctx) => {
    const r = await call("GET", "/orders/DY-20261022-AAAAA", { headers: bearer(TOKEN) });
    skipIfMissing(ctx, r, "GET /orders/{reference}");
    expectEnvelope(expect, r, 404, "NOT_FOUND");
  });
  it("GET /orders/{ref}?token= -> 400 (Bearer only; token never in URL)", async (ctx) => {
    const r = await call("GET", "/orders/DY-20261022-AAAAA", { query: { token: TOKEN } });
    skipIfMissing(ctx, r, "GET /orders/{reference}");
    expect(r.status, JSON.stringify(r.json)).toBe(400);
    expect(r.json?.error?.code).toBe("VALIDATION_ERROR");
  });
  it("GET /orders/{ref} without token -> 400/401/404, never 200", async (ctx) => {
    const r = await call("GET", "/orders/DY-20261022-AAAAA");
    skipIfMissing(ctx, r, "GET /orders/{reference}");
    expect([400, 401, 404]).toContain(r.status);
  });
  it("real reference + wrong Bearer -> 404 with the same body as unknown reference (no existence oracle)", async (ctx) => {
    const ref = env("QA_ORDER_REFERENCE"); if (!ref) ctx.skip("set QA_ORDER_REFERENCE (a seeded order)");
    const a = await call("GET", `/orders/${ref}`, { headers: bearer(TOKEN) });
    const b = await call("GET", "/orders/DY-20261022-AAAAA", { headers: bearer(TOKEN) });
    skipIfMissing(ctx, a, "GET /orders/{reference}");
    expect(a.status).toBe(404);
    expect(a.json).toEqual(b.json);
  });
  it("GET /checkout/{random}/status?token= -> 400 (Bearer only)", async (ctx) => {
    const r = await call("GET", `/checkout/${randomUUID()}/status`, { query: { token: TOKEN } });
    skipIfMissing(ctx, r, "checkout status");
    expect(r.status, JSON.stringify(r.json)).toBe(400);
  });
  it("GET /checkout/{random}/status with Bearer -> 404", async (ctx) => {
    const r = await call("GET", `/checkout/${randomUUID()}/status`, { headers: bearer(TOKEN) });
    skipIfMissing(ctx, r, "checkout status");
    expectEnvelope(expect, r, 404, "NOT_FOUND");
  });
  it("real checkout + wrong Bearer -> 404; ?token= -> 400", async (ctx) => {
    if (!f) ctx.skip("no buyable fixture");
    const co = await call("POST", "/checkout", { body: checkoutBody(f, { idempotencyKey: randomUUID() }) });
    if (co.status !== 201) ctx.skip("checkout not available");
    const id = co.json.data.checkoutId;
    expectEnvelope(expect, await call("GET", `/checkout/${id}/status`, { headers: bearer(TOKEN) }), 404, "NOT_FOUND");
    const q = await call("GET", `/checkout/${id}/status`, { query: { token: TOKEN } });
    expect(q.status).toBe(400);
  });
  it("visiting success/return URLs with forged 'paid' params never creates or marks an order paid", async (ctx) => {
    if (!f) ctx.skip("no buyable fixture");
    const co = await call("POST", "/checkout", { body: checkoutBody(f, { idempotencyKey: randomUUID() }) });
    if (co.status !== 201) ctx.skip("checkout not available");
    const id = co.json.data.checkoutId;
    for (const p of [`/uz/checkout/success?checkoutId=${id}&status=paid&payment_status=2`, `/uz/order/DY-20261022-AAAAA?paid=1&checkoutId=${id}`,
      `/uz/checkout/success?checkoutId=${id}&click_trans_id=1&error=0`]) {
      await fetch(SITE_URL + p, { redirect: "manual" }).catch(() => {});
    }
    const owner = env("QA_ADMIN_COOKIE_OWNER");
    if (!owner) ctx.skip("set QA_ADMIN_COOKIE_OWNER to verify no order was created");
    const o = await call("GET", "/admin/orders", { headers: { cookie: owner }, query: { q: id } });
    expect(o.json.data.filter((x) => x.status === "paid")).toEqual([]);
  });
});
