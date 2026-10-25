/** Payme/Click use convert(..., { conflictMode: "abort" }): reservation lapsed between our check and convert -> no order. */
import { describe, expect, it, vi } from "vitest";
import { createCheckout } from "../checkout/service";
import { CLICK_SECRET, PAYME_KEY, setup } from "./__tests__/fixtures";
import type { PaymeAdapter } from "./payme/adapter";
import type { ClickAdapter } from "./click/adapter";
import { clickSignString, minorToClickAmount } from "./click/protocol";

describe("convert conflictMode abort", () => {
  it("memory store: abort writes nothing; record writes stock_conflict", async () => {
    const f = setup();
    const d = await createCheckout(f.deps, f.provider, f.request());
    f.clock.advanceMin(36);
    const input = { reference: "DY-TEST-1", provider: "mock" as const, providerPaymentId: "p1", amountMinor: 1, currency: "UZS", paidAt: f.clock.now() };
    const a = await f.store.convert(d.checkoutId, input, { conflictMode: "abort" });
    expect(a.status).toBe("aborted");
    expect(f.store.s.orders.size).toBe(0);
    expect((await f.store.convert(d.checkoutId, input)).status).toBe("stock_conflict");
    expect(f.store.s.orders.size).toBe(1);
  });

  it("Payme Perform: race (reservation looked active, convert aborts) -> -31008, no order, txn -1, stock released", async () => {
    const f = setup("payme");
    const d = await createCheckout(f.deps, f.provider, f.request());
    const a = f.provider as PaymeAdapter;
    const auth = `Basic ${Buffer.from(`Paycom:${PAYME_KEY}`).toString("base64")}`;
    let n = 0;
    const rpc = async (method: string, params: Record<string, unknown>) => (await a.handleRpc(JSON.stringify({ method, params, id: ++n }), new Headers({ authorization: auth }), { method: "POST", ip: "185.234.113.1" })) as { result?: Record<string, unknown>; error?: { code: number } };
    const id = "6305e3bab097f420a62ced0c";
    await rpc("CreateTransaction", { id, time: f.clock.t, amount: d.totals.totalMinor, account: { order_id: d.checkoutId } });
    f.clock.advanceMin(36);
    const spy = vi.spyOn(f.store, "isReservationActive").mockResolvedValue(true);
    const convert = vi.spyOn(f.store, "convert");
    expect((await rpc("PerformTransaction", { id })).error?.code).toBe(-31008);
    expect(convert.mock.calls[0]![2]).toEqual({ conflictMode: "abort" });
    spy.mockRestore();
    expect(f.store.s.orders.size).toBe(0);
    expect(f.store.s.payments.size).toBe(0);
    expect(f.store.stock(f.v1)).toEqual({ onHand: 5, reserved: 0 });
    expect((await rpc("CheckTransaction", { id })).result).toMatchObject({ state: -1 });
  });

  it("Click Complete: race -> -9, no order, stock released", async () => {
    const f = setup("click");
    const d = await createCheckout(f.deps, f.provider, f.request());
    const a = f.provider as ClickAdapter;
    const amount = minorToClickAmount(d.totals.totalMinor, "UZS");
    const send = async (action: "0" | "1", prepareId?: number) => {
      const fields: Record<string, string> = { click_trans_id: "777", service_id: "123", click_paydoc_id: "888", merchant_trans_id: d.checkoutId, amount, action, error: "0", error_note: "Success", sign_time: "2026-10-22 12:00:00" };
      if (prepareId !== undefined) fields.merchant_prepare_id = String(prepareId);
      fields.sign_string = clickSignString(fields as never, CLICK_SECRET);
      return a.handle(new URLSearchParams(fields).toString());
    };
    const p = await send("0");
    expect(p.error).toBe(0);
    f.clock.advanceMin(36);
    const spy = vi.spyOn(f.store, "isReservationActive").mockResolvedValue(true);
    expect(await send("1", p.merchant_prepare_id as number)).toMatchObject({ error: -9 });
    spy.mockRestore();
    expect(f.store.s.orders.size).toBe(0);
    expect(f.store.stock(f.v1).reserved).toBe(0);
  });
});
