/**
 * Route-level tests (contracts main 12599c0): token ONLY via Authorization: Bearer on status/orders, `?token=` -> 400;
 * POST /checkout 201 with accessToken, replay 200 with the same derived accessToken, conflicting replay 409 IDEMPOTENCY_CONFLICT.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SHIRT = "00000000-0000-4000-8000-000000000037";
const STD = "00000000-0000-4000-b000-000000000001";
type Json = { data?: Record<string, unknown>; error?: { code: string; message: string } };

async function routes() {
  const checkout = await import("@/app/api/v1/checkout/route");
  const status = await import("@/app/api/v1/checkout/[checkoutId]/status/route");
  const sandbox = await import("@/app/api/v1/checkout/[checkoutId]/sandbox-pay/route");
  const orders = await import("@/app/api/v1/orders/[reference]/route");
  const create = async (over: Record<string, unknown> = {}) => {
    const body = { email: "buyer@example.com", locale: "en", items: [{ variantId: SHIRT, quantity: 1 }], shippingAddress: { fullName: "T", line1: "Amir Temur 1", city: "Tashkent", country: "UZ" }, shippingMethodId: STD, ...over };
    const res = await checkout.POST(new Request("http://x/api/v1/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    return { res, json: (await res.json()) as Json };
  };
  const getStatus = async (id: string, opts: { bearer?: string; query?: string } = {}) => {
    const res = await status.GET(new Request(`http://x/api/v1/checkout/${id}/status${opts.query ? `?token=${opts.query}` : ""}`, { headers: opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {} }), { params: Promise.resolve({ checkoutId: id }) });
    return { res, json: (await res.json()) as Json };
  };
  const getOrder = async (ref: string, opts: { bearer?: string; query?: string; raw?: string } = {}) => {
    const headers: Record<string, string> = opts.raw ? { authorization: opts.raw } : opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {};
    const res = await orders.GET(new Request(`http://x/api/v1/orders/${ref}${opts.query ? `?token=${opts.query}` : ""}`, { headers }), { params: Promise.resolve({ reference: ref }) });
    return { res, json: (await res.json()) as Json };
  };
  const pay = async (id: string, token: string) => sandbox.POST(new Request(`http://x/api/v1/checkout/${id}/sandbox-pay`, { method: "POST", body: JSON.stringify({ token, outcome: "success" }) }), { params: Promise.resolve({ checkoutId: id }) });
  return { create, getStatus, getOrder, pay };
}

describe("checkout/status/orders routes (memory store, sandbox)", () => {
  beforeEach(() => {
    delete (globalThis as { __dyMemoryStore?: unknown }).__dyMemoryStore;
    for (const [k, v] of Object.entries({ NODE_ENV: "test", PAYMENT_MODE: "sandbox", PAYMENT_PROVIDER: "mock", PAYMENTS_STORE: "memory", PAYMENTS_DEMO_SEED: "true", SANDBOX_SIMULATOR_ENABLED: "true", ORDER_TOKEN_SECRET: "o".repeat(40), PAYMENT_WEBHOOK_SECRET: "whsec_route_test_0123456789", NEXT_PUBLIC_SITE_URL: "http://localhost:3000" })) vi.stubEnv(k, v);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("201 with accessToken; status + order work with Bearer only; ?token= -> 400", async () => {
    const r = await routes();
    const { res, json } = await r.create({ idempotencyKey: randomUUID() });
    expect(res.status).toBe(201);
    const id = json.data!.checkoutId as string;
    const tok = json.data!.accessToken as string;
    expect(tok).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(json.data!.redirectUrl as string).not.toContain(tok);

    const ok = await r.getStatus(id, { bearer: tok });
    expect(ok.res.status).toBe(200);
    expect(ok.json.data!.checkoutStatus).toBe("awaiting_payment");
    // query token: rejected even when correct, alone or alongside a valid header
    expect((await r.getStatus(id, { query: tok })).res.status).toBe(400);
    expect((await r.getStatus(id, { bearer: tok, query: tok })).res.status).toBe(400);
    // missing header -> 400 (unchanged); wrong token -> 404
    expect((await r.getStatus(id)).res.status).toBe(400);
    expect((await r.getStatus(id, { bearer: "x".repeat(43) })).res.status).toBe(404);
    expect((await r.getStatus(randomUUID(), { bearer: tok })).res.status).toBe(404);

    expect((await r.pay(id, tok)).status).toBe(200);
    const after = await r.getStatus(id, { bearer: tok });
    const ref = after.json.data!.orderReference as string;
    expect(after.json.data!.orderStatus).toBe("paid");

    const o = await r.getOrder(ref, { bearer: tok });
    expect(o.res.status).toBe(200);
    expect(o.res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(o.json.data!.reference).toBe(ref);
    expect((await r.getOrder(ref, { query: tok })).res.status).toBe(400);
    expect((await r.getOrder(ref, { bearer: tok, query: tok })).res.status).toBe(400);
    for (const raw of [undefined, `Basic ${tok}`, `Bearer`, `bearer ${tok}`, `Bearer ${"x".repeat(43)}`]) {
      expect((await r.getOrder(ref, raw ? { raw } : {})).res.status).toBe(404);
    }
  });

  it("same idempotencyKey + same payload -> 200, same checkout, same accessToken; different payload -> 409 IDEMPOTENCY_CONFLICT", async () => {
    const r = await routes();
    const key = randomUUID();
    const first = await r.create({ idempotencyKey: key });
    expect(first.res.status).toBe(201);
    const again = await r.create({ idempotencyKey: key });
    expect(again.res.status).toBe(200);
    expect(again.json.data!.checkoutId).toBe(first.json.data!.checkoutId);
    expect(again.json.data!.accessToken).toBe(first.json.data!.accessToken);
    expect(again.json.data!.totals).toEqual(first.json.data!.totals);
    const conflict = await r.create({ idempotencyKey: key, email: "someone@example.com" });
    expect(conflict.res.status).toBe(409);
    expect(conflict.json.error!.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("idempotencyKey that is not a UUID (contracts z.uuid()) -> 400", async () => {
    const r = await routes();
    for (const k of ["not-a-uuid", "6f1c2b9e1d2a4c3b8e4f5a6b7c8d9e0f"]) {
      const { res } = await r.create({ idempotencyKey: k });
      expect(res.status).toBe(400);
    }
  });

  it("QA P2: our own response failing its schema -> 500 INTERNAL (not 400); bad request stays 400", async () => {
    const r = await routes();
    const { json } = await r.create();
    const id = json.data!.checkoutId as string;
    const tok = json.data!.accessToken as string;
    // corrupt the stored row so the service returns a value outside the contract enum (simulated server bug)
    const store = (globalThis as unknown as { __dyMemoryStore: { s: { checkouts: Map<string, { status: string }> } } }).__dyMemoryStore;
    store.s.checkouts.get(id)!.status = "bogus";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = await r.getStatus(id, { bearer: tok });
    expect(bad.res.status).toBe(500);
    expect(bad.json.error!.code).toBe("INTERNAL");
    expect(JSON.stringify(bad.json)).not.toContain("bogus");
    expect(JSON.stringify(err.mock.calls)).not.toContain(tok);
    err.mockRestore();
    const badReq = await r.create({ items: [] });
    expect(badReq.res.status).toBe(400);
    expect(badReq.json.error!.code).toBe("VALIDATION_ERROR");
  });

  it("public checkout errors never reveal stock counts; quantity capped by contract MAX_LINE_QTY", async () => {
    const { MAX_LINE_QTY } = await import("@/contracts/cart");
    const r = await routes();
    // tote: demo stock 1 -> asking for 2 is OUT_OF_STOCK
    const tote = "00000000-0000-4000-8000-000000000082";
    const oos = await r.create({ items: [{ variantId: tote, quantity: 2 }] });
    expect(oos.res.status).toBe(409);
    expect(oos.json.error!.code).toBe("OUT_OF_STOCK");
    expect(Object.keys((oos.json.error as unknown as { details: object }).details)).toEqual(["variantIds"]);
    const details = (oos.json.error as unknown as { details: { variantIds: unknown[] } }).details;
    expect(details.variantIds).toEqual([tote]);
    // no count anywhere in the body (message included): no bare numbers, no stock vocabulary
    expect(JSON.stringify(oos.json)).not.toMatch(/stock_?on|onHand|reserved|remaining|left|:\s*-?[0-9]+[,}]/i);
    const tooMany = await r.create({ items: [{ variantId: SHIRT, quantity: MAX_LINE_QTY + 1 }] });
    expect(tooMany.res.status).toBe(400);
  });
});
