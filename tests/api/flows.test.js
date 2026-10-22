// Live: guest order access, success page never marks paid.
import { describe, it, expect, beforeAll } from "vitest";
import { UP, DOWN_REASON, call, skipIfMissing, expectEnvelope, env, SITE_URL, randomUUID } from "./lib/http.js";
import { buyable, checkoutBody } from "./lib/fixtures.js";

const TOKEN = "q".repeat(40);
describe.skipIf(!UP)(`guest access + success page${UP ? "" : ` [SKIPPED: ${DOWN_REASON}]`}`, () => {
  let f; beforeAll(async () => { f = await buyable(); });

  it("GET /orders/{unknown ref}?token=<valid-length> -> 404 NOT_FOUND", async (ctx) => {
    const r = await call("GET", "/orders/DY-20261022-AAAAA", { query: { token: TOKEN } });
    skipIfMissing(ctx, r, "GET /orders/{reference}");
    expectEnvelope(expect, r, 404, "NOT_FOUND");
  });
  it("GET /orders/{ref} without token -> 400/404, never 200/403", async (ctx) => {
    const r = await call("GET", "/orders/DY-20261022-AAAAA");
    skipIfMissing(ctx, r, "GET /orders/{reference}");
    expect([400, 404]).toContain(r.status);
  });
  it("real reference + wrong token -> 404 with the same body as unknown reference (no existence oracle)", async (ctx) => {
    const ref = env("QA_ORDER_REFERENCE"); if (!ref) ctx.skip("set QA_ORDER_REFERENCE (a seeded order)");
    const a = await call("GET", `/orders/${ref}`, { query: { token: TOKEN } });
    const b = await call("GET", "/orders/DY-20261022-AAAAA", { query: { token: TOKEN } });
    skipIfMissing(ctx, a, "GET /orders/{reference}");
    expect(a.status).toBe(404);
    expect(a.json).toEqual(b.json);
  });
  it("GET /checkout/{random}/status?token= -> 404", async (ctx) => {
    const r = await call("GET", `/checkout/${randomUUID()}/status`, { query: { token: TOKEN } });
    skipIfMissing(ctx, r, "checkout status");
    expectEnvelope(expect, r, 404, "NOT_FOUND");
  });
  it("real checkout + wrong token -> 404", async (ctx) => {
    if (!f) ctx.skip("no buyable fixture");
    const co = await call("POST", "/checkout", { body: checkoutBody(f, { idempotencyKey: randomUUID() }) });
    if (co.status !== 201) ctx.skip("checkout not available");
    const r = await call("GET", `/checkout/${co.json.data.checkoutId}/status`, { query: { token: TOKEN } });
    expectEnvelope(expect, r, 404, "NOT_FOUND");
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
