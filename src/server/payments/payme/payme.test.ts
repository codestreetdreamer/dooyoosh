import { describe, expect, it } from "vitest";
import { createCheckout } from "../../checkout/service";
import { transitionOrder } from "../../orders/transitions";
import { PAYME_KEY, setup } from "../__tests__/fixtures";
import type { PaymeAdapter } from "./adapter";
import { buildPaymeCheckoutUrl, verifyPaymeAuth } from "./protocol";

const AUTH = `Basic ${Buffer.from(`Paycom:${PAYME_KEY}`).toString("base64")}`;
const TXN = "5305e3bab097f420a62ced0b";

async function payme(fx?: { fiscal?: boolean; stock?: number }) {
  const f = setup("payme", fx);
  const d = await createCheckout(f.deps, f.provider, f.request());
  const a = f.provider as PaymeAdapter;
  let n = 0;
  const rpc = async (method: string, params: Record<string, unknown>, auth = AUTH) => {
    const res = await a.handleRpc(JSON.stringify({ method, params, id: ++n }), new Headers({ authorization: auth }), { method: "POST", ip: "185.234.113.1" });
    return res as { result?: Record<string, unknown>; error?: { code: number; message: Record<string, string>; data?: unknown }; id: unknown };
  };
  const account = { order_id: d.checkoutId };
  return { f, d, rpc, account, amount: d.totals.totalMinor };
}

describe("Payme auth & protocol", () => {
  it("verifies Basic auth in constant time; wrong key/login -> -32504", async () => {
    expect(verifyPaymeAuth(AUTH, PAYME_KEY, "Paycom")).toBe(true);
    expect(verifyPaymeAuth(AUTH, PAYME_KEY + "x", "Paycom")).toBe(false);
    expect(verifyPaymeAuth(`Basic ${Buffer.from(`Other:${PAYME_KEY}`).toString("base64")}`, PAYME_KEY, "Paycom")).toBe(false);
    expect(verifyPaymeAuth(null, PAYME_KEY)).toBe(false);
    const { rpc, account, amount } = await payme();
    const r = await rpc("CheckPerformTransaction", { amount, account }, "Basic d3Jvbmc6d3Jvbmc=");
    expect(r.error?.code).toBe(-32504);
    expect(r.id).toBe(1);
  });
  it("unknown method -32601 with method in data; parse error -32700", async () => {
    const { f, rpc } = await payme();
    expect((await rpc("ChangePassword", {})).error).toMatchObject({ code: -32601, data: "ChangePassword" });
    const bad = await (f.provider as PaymeAdapter).handleRpc("{oops", new Headers({ authorization: AUTH }));
    expect(bad.error).toMatchObject({ code: -32700 });
  });
  it("builds the GET checkout URL per docs (base64 of m=..;ac.order_id=..;a=..)", () => {
    const url = buildPaymeCheckoutUrl({ host: "https://test.paycom.uz", merchantId: "587f72c72cac0d162c722ae2", accountField: "order_id", checkoutId: "197", amountTiyin: 500, lang: "uz", returnUrl: "https://s/x" });
    expect(Buffer.from(url.split("/").pop()!, "base64").toString()).toBe("m=587f72c72cac0d162c722ae2;ac.order_id=197;a=500;l=uz;c=https://s/x");
  });
});

describe("Payme Merchant API flow", () => {
  it("CheckPerformTransaction: allow, wrong amount -31001, unknown account -31050 with data=field", async () => {
    const { rpc, account, amount } = await payme();
    expect((await rpc("CheckPerformTransaction", { amount, account })).result).toEqual({ allow: true });
    expect((await rpc("CheckPerformTransaction", { amount: amount + 100, account })).error?.code).toBe(-31001);
    const r = await rpc("CheckPerformTransaction", { amount, account: { order_id: "00000000-0000-4000-8000-000000000000" } });
    expect(r.error).toMatchObject({ code: -31050, data: "order_id" });
    expect(r.error?.message).toHaveProperty("uz");
  });

  it("CheckPerformTransaction returns fiscal `detail` when IKPU/package/VAT exist", async () => {
    const { rpc, account, amount } = await payme({ fiscal: true });
    const r = await rpc("CheckPerformTransaction", { amount, account });
    expect(r.result).toMatchObject({ allow: true, detail: { receipt_type: 0, shipping: { title: "Tashkent courier", price: 3_000_000 } } });
    expect((r.result!.detail as { items: unknown[] }).items[0]).toEqual({ title: "Linen tee M", price: 25_000_000, count: 2, code: "06109001001000000", package_code: "1500889", vat_percent: 12 });
  });

  it("Create is idempotent; a second transaction for the same order -> -31008", async () => {
    const { rpc, account, amount, f } = await payme();
    const time = f.clock.t;
    const c1 = await rpc("CreateTransaction", { id: TXN, time, amount, account });
    const c2 = await rpc("CreateTransaction", { id: TXN, time, amount, account });
    expect(c1.result).toMatchObject({ state: 1 });
    expect(c2.result).toEqual(c1.result);
    expect((await rpc("CreateTransaction", { id: "6305e3bab097f420a62ced0c", time, amount, account })).error?.code).toBe(-31008);
  });

  it("Perform -> order paid once; repeated Perform returns the same answer and does not decrement stock twice", async () => {
    const { rpc, account, amount, f } = await payme();
    await rpc("CreateTransaction", { id: TXN, time: f.clock.t, amount, account });
    const p1 = await rpc("PerformTransaction", { id: TXN });
    const p2 = await rpc("PerformTransaction", { id: TXN });
    expect(p1.result).toMatchObject({ state: 2 });
    expect(p2.result).toEqual(p1.result);
    expect(f.store.s.orders.size).toBe(1);
    expect([...f.store.s.orders.values()][0]!.status).toBe("paid");
    expect(f.store.stock(f.v1)).toEqual({ onHand: 3, reserved: 0 });
    const ct = await rpc("CheckTransaction", { id: TXN });
    expect(ct.result).toMatchObject({ state: 2, cancel_time: 0, reason: null });
    expect((await rpc("CheckTransaction", { id: "ffffffffffffffffffffffff" })).error?.code).toBe(-31003);
  });

  it("concurrent Perform retries create exactly one order", async () => {
    const { rpc, account, amount, f } = await payme();
    await rpc("CreateTransaction", { id: TXN, time: f.clock.t, amount, account });
    const rs = await Promise.all([rpc("PerformTransaction", { id: TXN }), rpc("PerformTransaction", { id: TXN }), rpc("PerformTransaction", { id: TXN })]);
    expect(rs.every((r) => r.result?.state === 2)).toBe(true);
    expect(f.store.s.orders.size).toBe(1);
    expect(f.store.stock(f.v1).onHand).toBe(3);
  });

  it("Perform after the 35 min reservation expired -> -31008, txn cancelled, NO order, stock released", async () => {
    const { rpc, account, amount, f } = await payme();
    await rpc("CreateTransaction", { id: TXN, time: f.clock.t, amount, account });
    f.clock.advanceMin(36);
    const p = await rpc("PerformTransaction", { id: TXN });
    expect(p.error?.code).toBe(-31008);
    expect(f.store.s.orders.size).toBe(0);
    expect(f.store.stock(f.v1)).toEqual({ onHand: 5, reserved: 0 });
    expect((await rpc("CheckTransaction", { id: TXN })).result).toMatchObject({ state: -1, reason: 3 });
  });

  it("Create after 12 h timeout -> cancelled with reason 4", async () => {
    const { rpc, account, amount, f } = await payme();
    const time = f.clock.t;
    await rpc("CreateTransaction", { id: TXN, time, amount, account });
    f.clock.advanceMin(12 * 60 + 1);
    expect((await rpc("CreateTransaction", { id: TXN, time, amount, account })).error?.code).toBe(-31008);
    expect((await rpc("CheckTransaction", { id: TXN })).result).toMatchObject({ state: -1, reason: 4 });
  });

  it("Cancel before Perform (state 1) releases the reservation; repeat returns the same", async () => {
    const { rpc, account, amount, f } = await payme();
    await rpc("CreateTransaction", { id: TXN, time: f.clock.t, amount, account });
    const c1 = await rpc("CancelTransaction", { id: TXN, reason: 3 });
    const c2 = await rpc("CancelTransaction", { id: TXN, reason: 3 });
    expect(c1.result).toMatchObject({ state: -1 });
    expect(c2.result).toEqual(c1.result);
    expect(f.store.stock(f.v1).reserved).toBe(0);
  });

  it("Cancel after Perform = refund: order refunded, restock with reason 'return' exactly once", async () => {
    const { rpc, account, amount, f } = await payme();
    await rpc("CreateTransaction", { id: TXN, time: f.clock.t, amount, account });
    await rpc("PerformTransaction", { id: TXN });
    const c1 = await rpc("CancelTransaction", { id: TXN, reason: 5 });
    const c2 = await rpc("CancelTransaction", { id: TXN, reason: 5 });
    expect(c1.result).toMatchObject({ state: -2 });
    expect(c2.result).toEqual(c1.result);
    const order = [...f.store.s.orders.values()][0]!;
    expect(order.status).toBe("refunded");
    expect(f.store.stock(f.v1)).toEqual({ onHand: 5, reserved: 0 });
    expect(f.store.s.movements.filter((m) => m.reason === "return")).toHaveLength(2);
    expect((await rpc("CheckTransaction", { id: TXN })).result).toMatchObject({ state: -2, reason: 5 });
  });

  it("Cancel after the order shipped -> -31007", async () => {
    const { rpc, account, amount, f } = await payme();
    await rpc("CreateTransaction", { id: TXN, time: f.clock.t, amount, account });
    await rpc("PerformTransaction", { id: TXN });
    const o = [...f.store.s.orders.values()][0]!;
    const admin = { kind: "admin" as const, actorId: "11111111-1111-4111-8111-111111111111" };
    await transitionOrder(f.store, o.id, "fulfilling", admin);
    await transitionOrder(f.store, o.id, "shipped", admin);
    expect((await rpc("CancelTransaction", { id: TXN, reason: 5 })).error?.code).toBe(-31007);
  });

  it("GetStatement lists created transactions in [from,to] by Payme time, ascending", async () => {
    const { rpc, account, amount, f } = await payme();
    const time = f.clock.t;
    await rpc("CreateTransaction", { id: TXN, time, amount, account });
    const s = await rpc("GetStatement", { from: time - 1, to: time + 1 });
    expect(s.result).toMatchObject({ transactions: [{ id: TXN, time, amount, account, state: 1, transaction: "1" }] });
    expect((await rpc("GetStatement", { from: 0, to: time - 1 })).result).toEqual({ transactions: [] });
  });

  it("live mode enforces Payme source IPs", async () => {
    const f = setup("payme");
    f.deps.config.payme!.enforceIp = true;
    const a = f.provider as PaymeAdapter;
    const r = await a.handleRpc(JSON.stringify({ method: "CheckTransaction", params: { id: TXN }, id: 1 }), new Headers({ authorization: AUTH }), { method: "POST", ip: "8.8.8.8" });
    expect(r.error).toMatchObject({ code: -32504 });
  });
});
