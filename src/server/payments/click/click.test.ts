import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCheckout } from "../../checkout/service";
import { CLICK_SECRET, setup } from "../__tests__/fixtures";
import type { ClickAdapter } from "./adapter";
import { clickAmountToMinor, clickSignString, minorToClickAmount, parseClickBody, verifyClickSign } from "./protocol";

describe("Click sign_string (docs.click.uz/shop-api/requests)", () => {
  it("matches md5(click_trans_id + service_id + SECRET + merchant_trans_id [+ merchant_prepare_id] + amount + action + sign_time)", () => {
    const base = { click_trans_id: "134", service_id: "123", merchant_trans_id: "ord-1", amount: "1000.00", sign_time: "2026-10-22 12:00:00" };
    const md5 = (s: string) => createHash("md5").update(s).digest("hex");
    expect(clickSignString({ ...base, action: "0" }, "SECRET")).toBe(md5("134123SECRETord-11000.0002026-10-22 12:00:00"));
    expect(clickSignString({ ...base, action: "1", merchant_prepare_id: "7" }, "SECRET")).toBe(md5("134123SECRETord-171000.0012026-10-22 12:00:00"));
  });
  it("rejects tampered amount or wrong secret", () => {
    const fields = { click_trans_id: "1", service_id: "123", click_paydoc_id: "1", merchant_trans_id: "m", amount: "5.00", action: "0", error: "0", error_note: "", sign_time: "t" };
    const sign_string = clickSignString(fields, CLICK_SECRET);
    expect(verifyClickSign({ ...fields, sign_string }, CLICK_SECRET)).toBe(true);
    expect(verifyClickSign({ ...fields, amount: "500.00", sign_string }, CLICK_SECRET)).toBe(false);
    expect(verifyClickSign({ ...fields, sign_string }, "other")).toBe(false);
  });
  it("amount soums <-> tiyin without floats", () => {
    expect(clickAmountToMinor("650000", "UZS")).toBe(65_000_000);
    expect(clickAmountToMinor("650000.5", "UZS")).toBe(65_000_050);
    expect(clickAmountToMinor("650000.50", "UZS")).toBe(65_000_050);
    expect(clickAmountToMinor("1e5", "UZS")).toBeNull();
    expect(clickAmountToMinor("1.005", "UZS")).toBeNull();
    expect(minorToClickAmount(65_000_050, "UZS")).toBe("650000.50");
  });
  it("missing fields -> null (answered -8)", () => expect(parseClickBody("click_trans_id=1")).toBeNull());
});

async function click(stock?: number) {
  const f = setup("click", { stock });
  const d = await createCheckout(f.deps, f.provider, f.request());
  const a = f.provider as ClickAdapter;
  const send = async (o: { action: "0" | "1"; trans?: string; prepareId?: string | number; amount?: string; error?: string; secret?: string }) => {
    const fields: Record<string, string> = {
      click_trans_id: o.trans ?? "9001", service_id: "123", click_paydoc_id: "777", merchant_trans_id: d.checkoutId,
      amount: o.amount ?? minorToClickAmount(d.totals.totalMinor, "UZS"), action: o.action, error: o.error ?? "0", error_note: "Success", sign_time: "2026-10-22 12:00:00",
    };
    if (o.prepareId !== undefined) fields.merchant_prepare_id = String(o.prepareId);
    fields.sign_string = clickSignString(fields as never, o.secret ?? CLICK_SECRET);
    return a.handle(new URLSearchParams(fields).toString());
  };
  return { f, d, send };
}

describe("Click Prepare/Complete", () => {
  it("bad signature -> -1, nothing recorded", async () => {
    const { send, f } = await click();
    expect(await send({ action: "0", secret: "nope" })).toMatchObject({ error: -1, error_note: "SIGN CHECK FAILED!" });
    expect(f.store.s.providerTxns.size).toBe(0);
  });
  it("Prepare verifies only; wrong amount -2; repeat Prepare returns the same merchant_prepare_id", async () => {
    const { send, f } = await click();
    expect(await send({ action: "0", amount: "1.00" })).toMatchObject({ error: -2 });
    const p1 = await send({ action: "0" });
    const p2 = await send({ action: "0" });
    expect(p1).toMatchObject({ error: 0, merchant_prepare_id: 1 });
    expect(p2).toEqual(p1);
    expect(f.store.s.orders.size).toBe(0);
    expect(f.store.stock(f.v1).reserved).toBe(2); // reserved by checkout, not re-reserved by Prepare
  });
  it("Complete -> order paid; duplicate Complete -> -4 Already paid, no second order or decrement", async () => {
    const { send, f } = await click();
    const p = await send({ action: "0" });
    const c1 = await send({ action: "1", prepareId: p.merchant_prepare_id as number });
    expect(c1).toMatchObject({ error: 0, merchant_confirm_id: 1 });
    const c2 = await send({ action: "1", prepareId: p.merchant_prepare_id as number });
    expect(c2).toMatchObject({ error: -4, error_note: "Already paid" });
    expect(f.store.s.orders.size).toBe(1);
    expect(f.store.stock(f.v1)).toEqual({ onHand: 3, reserved: 0 });
  });
  it("Complete with unknown merchant_prepare_id -> -6", async () => {
    const { send } = await click();
    await send({ action: "0" });
    expect(await send({ action: "1", prepareId: 999999999 })).toMatchObject({ error: -6 });
  });
  it("Complete after reservation expired -> -9, no order, stock released", async () => {
    const { send, f } = await click();
    const p = await send({ action: "0" });
    f.clock.advanceMin(36);
    expect(await send({ action: "1", prepareId: p.merchant_prepare_id as number })).toMatchObject({ error: -9 });
    expect(f.store.s.orders.size).toBe(0);
    expect(f.store.stock(f.v1).reserved).toBe(0);
  });
  it("Complete with error=-5017 (debit failed) -> -9, reservation released; repeat stays -9", async () => {
    const { send, f } = await click();
    const p = await send({ action: "0" });
    expect(await send({ action: "1", prepareId: p.merchant_prepare_id as number, error: "-5017" })).toMatchObject({ error: -9 });
    expect(await send({ action: "1", prepareId: p.merchant_prepare_id as number, error: "-5017" })).toMatchObject({ error: -9 });
    expect(await send({ action: "1", prepareId: p.merchant_prepare_id as number })).toMatchObject({ error: -9 });
    expect(f.store.stock(f.v1).reserved).toBe(0);
    expect(f.store.s.orders.size).toBe(0);
  });
  it("error<0 after a completed payment -> refund path, restock 'return', -9", async () => {
    const { send, f } = await click();
    const p = await send({ action: "0" });
    await send({ action: "1", prepareId: p.merchant_prepare_id as number });
    expect(await send({ action: "1", prepareId: p.merchant_prepare_id as number, error: "-5017" })).toMatchObject({ error: -9 });
    expect([...f.store.s.orders.values()][0]!.status).toBe("refunded");
    expect(f.store.stock(f.v1).onHand).toBe(5);
  });
  it("unknown order -> -5", async () => {
    const f = setup("click");
    const fields: Record<string, string> = { click_trans_id: "1", service_id: "123", click_paydoc_id: "1", merchant_trans_id: "00000000-0000-4000-8000-000000000000", amount: "1.00", action: "0", error: "0", error_note: "", sign_time: "t" };
    fields.sign_string = clickSignString(fields as never, CLICK_SECRET);
    expect(await (f.provider as ClickAdapter).handle(new URLSearchParams(fields).toString())).toMatchObject({ error: -5 });
  });
});
