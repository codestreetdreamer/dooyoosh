// Stock functions (SCHEMA_DELTA A8, migration 0002). Each test skips until the function exists.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { cfg, pool, seedVariant, seedCheckout, hasFunction } from "./setup/db.js";

let p; const has = {};
beforeAll(async () => {
  p = pool();
  for (const f of ["reserve_checkout", "convert_checkout_to_order", "release_checkout", "release_expired_reservations", "adjust_stock"]) has[f] = await hasFunction(p, f);
});
afterAll(() => p.end());
const items = (v, q) => JSON.stringify([{ variant_id: v, quantity: q }]);
const ord = (ref, amount = 125000000) => JSON.stringify({ reference: ref, provider: "mock", provider_payment_id: `pp-${ref}`, amount_minor: amount, currency: "UZS", paid_at: new Date().toISOString() });
const ref = () => "DY-20261022-" + Array.from({ length: 5 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[Math.floor(Math.random() * 32)]).join("");
const stock = async (v) => (await p.query("SELECT stock_on_hand, stock_reserved FROM product_variants WHERE id=$1", [v])).rows[0];

describe("reserve_checkout (0002)", () => {
  it("20 concurrent checkouts for the last unit -> exactly 1 succeeds, others OUT_OF_STOCK with variant id in DETAIL", async (ctx) => {
    if (!has.reserve_checkout) ctx.skip("reserve_checkout not migrated yet");
    const v = await seedVariant(p, { onHand: 1 });
    const cos = []; for (let i = 0; i < 20; i++) cos.push((await seedCheckout(p, { lines: [[v, 1]] })).checkoutId);
    const res = await Promise.all(cos.map(async (co) => {
      const c = new pg.Client(cfg); await c.connect();
      try { await c.query("SELECT public.reserve_checkout($1,$2::jsonb, now()+interval '35 min')", [co, items(v, 1)]); return "ok"; }
      catch (e) { return e; } finally { await c.end(); }
    }));
    expect(res.filter((r) => r === "ok")).toHaveLength(1);
    const errs = res.filter((r) => r !== "ok");
    for (const e of errs) { expect(e.code).toBe("P0001"); expect(e.message).toMatch(/OUT_OF_STOCK/); expect(e.detail).toContain(v); }
    expect(await stock(v)).toEqual({ stock_on_hand: 1, stock_reserved: 1 });
  });
  it("quantity 0 / -1 rejected; reserved unchanged", async (ctx) => {
    if (!has.reserve_checkout) ctx.skip("reserve_checkout not migrated yet");
    const v = await seedVariant(p, { onHand: 5, reserved: 2 });
    for (const q of [0, -1]) {
      const { checkoutId } = await seedCheckout(p, { lines: [[v, 1]] });
      await expect(p.query("SELECT public.reserve_checkout($1,$2::jsonb, now()+interval '35 min')", [checkoutId, items(v, q)]))
        .rejects.toMatchObject({ code: "P0001", message: "VALIDATION_ERROR", detail: expect.stringContaining('"items"') });
    }
    expect((await stock(v)).stock_reserved).toBe(2);
  });
  it("multi-line: one short line aborts the whole reservation (all-or-nothing)", async (ctx) => {
    if (!has.reserve_checkout) ctx.skip("reserve_checkout not migrated yet");
    const a = await seedVariant(p, { onHand: 5 }); const b = await seedVariant(p, { onHand: 0 });
    const { checkoutId } = await seedCheckout(p, { lines: [[a, 1], [b, 1]] });
    const e = await p.query("SELECT public.reserve_checkout($1,$2::jsonb, now()+interval '35 min')",
      [checkoutId, JSON.stringify([{ variant_id: a, quantity: 1 }, { variant_id: b, quantity: 1 }])]).catch((x) => x);
    expect(e).toMatchObject({ code: "P0001", message: "OUT_OF_STOCK" });
    expect(JSON.parse(e.detail)).toEqual([b]);
    expect((await stock(a)).stock_reserved).toBe(0);
  });
});

describe("convert_checkout_to_order (0002)", () => {
  it("active reservation -> paid, stock_on_hand and reserved decremented, 'sale' movement", async (ctx) => {
    if (!has.convert_checkout_to_order) ctx.skip("convert_checkout_to_order not migrated yet");
    const v = await seedVariant(p, { onHand: 2 }); const { checkoutId } = await seedCheckout(p, { lines: [[v, 1]] });
    await p.query("SELECT public.reserve_checkout($1,$2::jsonb, now()+interval '35 min')", [checkoutId, items(v, 1)]);
    const r = (await p.query("SELECT public.convert_checkout_to_order($1,$2::jsonb) r", [checkoutId, ord(ref())])).rows[0].r;
    expect(r.status).toBe("paid");
    expect(await stock(v)).toEqual({ stock_on_hand: 1, stock_reserved: 0 });
    const m = await p.query("SELECT delta, reason FROM inventory_movements WHERE variant_id=$1", [v]);
    expect(m.rows).toContainEqual({ delta: -1, reason: "sale" });
  });
  it("replay -> already_converted, no second order, no second movement", async (ctx) => {
    if (!has.convert_checkout_to_order) ctx.skip("convert_checkout_to_order not migrated yet");
    const v = await seedVariant(p, { onHand: 2 }); const { checkoutId } = await seedCheckout(p, { lines: [[v, 1]] });
    await p.query("SELECT public.reserve_checkout($1,$2::jsonb, now()+interval '35 min')", [checkoutId, items(v, 1)]);
    const R = ref();
    await p.query("SELECT public.convert_checkout_to_order($1,$2::jsonb)", [checkoutId, ord(R)]);
    const r2 = (await p.query("SELECT public.convert_checkout_to_order($1,$2::jsonb) r", [checkoutId, ord(R)])).rows[0].r;
    expect(r2.status).toBe("already_converted");
    expect((await p.query("SELECT count(*)::int n FROM orders WHERE checkout_id=$1", [checkoutId])).rows[0].n).toBe(1);
    expect((await p.query("SELECT count(*)::int n FROM inventory_movements WHERE variant_id=$1 AND reason='sale'", [v])).rows[0].n).toBe(1);
  });
  it("released reservation (late payment) -> stock_conflict, no CHECK violation, other buyer's unit NOT stolen", async (ctx) => {
    if (!has.convert_checkout_to_order) ctx.skip("convert_checkout_to_order not migrated yet");
    const v = await seedVariant(p, { onHand: 1 });
    const A = (await seedCheckout(p, { lines: [[v, 1]] })).checkoutId; const B = (await seedCheckout(p, { lines: [[v, 1]] })).checkoutId;
    await p.query("SELECT public.reserve_checkout($1,$2::jsonb, now()+interval '35 min')", [A, items(v, 1)]);
    await p.query("SELECT public.release_checkout($1,'expired')", [A]);
    await p.query("SELECT public.reserve_checkout($1,$2::jsonb, now()+interval '35 min')", [B, items(v, 1)]);
    const r = (await p.query("SELECT public.convert_checkout_to_order($1,$2::jsonb) r", [A, ord(ref())])).rows[0].r;
    expect(r.status).toBe("stock_conflict");
    expect(r.conflict_variant_ids).toContain(v);
    expect(await stock(v)).toEqual({ stock_on_hand: 1, stock_reserved: 1 }); // B still holds it
  });
  it("expired-but-not-yet-swept reservation (expires_at < now) -> stock_conflict", async (ctx) => {
    if (!has.convert_checkout_to_order) ctx.skip("convert_checkout_to_order not migrated yet");
    const v = await seedVariant(p, { onHand: 1 }); const { checkoutId } = await seedCheckout(p, { lines: [[v, 1]] });
    await p.query("SELECT public.reserve_checkout($1,$2::jsonb, now()+interval '35 min')", [checkoutId, items(v, 1)]);
    await p.query("UPDATE stock_reservations SET expires_at = now()-interval '1 min' WHERE checkout_id=$1", [checkoutId]);
    const r = (await p.query("SELECT public.convert_checkout_to_order($1,$2::jsonb) r", [checkoutId, ord(ref())])).rows[0].r;
    // 0009: expires_at <= paid_at => stock_conflict even if the sweeper has not marked it expired.
    expect(r.status).toBe("stock_conflict");
    expect(await stock(v)).toEqual({ stock_on_hand: 1, stock_reserved: 0 });
  });
});

describe("release / expiry / adjust (0002)", () => {
  it("release_expired_reservations frees only expired active reservations, idempotent", async (ctx) => {
    if (!has.release_expired_reservations) ctx.skip("release_expired_reservations not migrated yet");
    const v = await seedVariant(p, { onHand: 3 });
    const live = (await seedCheckout(p, { lines: [[v, 1]] })).checkoutId; const dead = (await seedCheckout(p, { lines: [[v, 1]] })).checkoutId;
    await p.query("SELECT public.reserve_checkout($1,$2::jsonb, now()+interval '35 min')", [live, items(v, 1)]);
    await p.query("SELECT public.reserve_checkout($1,$2::jsonb, now()+interval '35 min')", [dead, items(v, 1)]);
    await p.query("UPDATE stock_reservations SET expires_at = now()-interval '1 min' WHERE checkout_id=$1", [dead]);
    await p.query("SELECT public.release_expired_reservations(now(), 500)");
    expect((await stock(v)).stock_reserved).toBe(1);
    await p.query("SELECT public.release_expired_reservations(now(), 500)");
    expect((await stock(v)).stock_reserved).toBe(1);
  });
  it("adjust_stock('return') restores on_hand and writes a 'return' movement (Payme CancelTransaction after Perform)", async (ctx) => {
    if (!has.adjust_stock) ctx.skip("adjust_stock not migrated yet");
    const v = await seedVariant(p, { onHand: 0 });
    const n = (await p.query("SELECT public.adjust_stock($1, 1, 'return', 'payme cancel', NULL) n", [v])).rows[0].n;
    expect(n).toBe(1);
    expect((await p.query("SELECT reason FROM inventory_movements WHERE variant_id=$1", [v])).rows).toContainEqual({ reason: "return" });
  });
  it("adjust_stock cannot take on_hand below reserved", async (ctx) => {
    if (!has.adjust_stock) ctx.skip("adjust_stock not migrated yet");
    const v = await seedVariant(p, { onHand: 2, reserved: 2 });
    await expect(p.query("SELECT public.adjust_stock($1, -1, 'damage', NULL, NULL)", [v])).rejects.toBeTruthy();
  });
  it("service_role cannot UPDATE stock columns directly (only via functions)", async (ctx) => {
    if (!has.reserve_checkout) ctx.skip("0002/0003 not migrated yet");
    const v = await seedVariant(p, { onHand: 2 });
    const c = await p.connect();
    try {
      await c.query("BEGIN; SET LOCAL ROLE service_role");
      await expect(c.query("UPDATE product_variants SET stock_reserved=0 WHERE id=$1", [v])).rejects.toMatchObject({ code: "42501" });
    } finally { await c.query("ROLLBACK"); c.release(); }
  });
});

describe("0002 server-side tamper checks (QA)", () => {
  it("snapshot price != DB price -> PRICE_CHANGED with variant id", async (ctx) => {
    if (!has.reserve_checkout) ctx.skip();
    const v = await seedVariant(p, { onHand: 2 }); const { checkoutId } = await seedCheckout(p, { lines: [[v, 1, 1]] });
    const e = await p.query("SELECT public.reserve_checkout($1,$2::jsonb, now()+interval '35 min')", [checkoutId, items(v, 1)]).catch((x) => x);
    expect(e).toMatchObject({ code: "P0001", message: "PRICE_CHANGED" }); expect(JSON.parse(e.detail)).toEqual([v]);
    expect((await stock(v)).stock_reserved).toBe(0);
  });
  it("tampered checkout subtotal -> VALIDATION_ERROR subtotal, nothing reserved", async (ctx) => {
    if (!has.reserve_checkout) ctx.skip();
    const v = await seedVariant(p, { onHand: 2 }); const { checkoutId } = await seedCheckout(p, { lines: [[v, 1]] });
    await p.query("UPDATE checkouts SET subtotal_cents = 1, total_cents = 1 WHERE id=$1", [checkoutId]);
    const e = await p.query("SELECT public.reserve_checkout($1,$2::jsonb, now()+interval '35 min')", [checkoutId, items(v, 1)]).catch((x) => x);
    expect(e).toMatchObject({ code: "P0001", message: "VALIDATION_ERROR" }); expect(e.detail).toContain("subtotal");
    expect((await stock(v)).stock_reserved).toBe(0);
  });
  it("convert with amount != checkout total -> rejected, no order, stock still reserved", async (ctx) => {
    if (!has.convert_checkout_to_order) ctx.skip();
    const v = await seedVariant(p, { onHand: 2 }); const { checkoutId } = await seedCheckout(p, { lines: [[v, 1]] });
    await p.query("SELECT public.reserve_checkout($1,$2::jsonb, now()+interval '35 min')", [checkoutId, items(v, 1)]);
    const e = await p.query("SELECT public.convert_checkout_to_order($1,$2::jsonb) r", [checkoutId, ord(ref(), 125000000 - 1)]).catch((x) => x);
    expect(e).toBeInstanceOf(Error); expect(e.message).toMatch(/AMOUNT_MISMATCH/);
    expect((await p.query("SELECT count(*)::int n FROM orders WHERE checkout_id=$1", [checkoutId])).rows[0].n).toBe(0);
    expect(await stock(v)).toEqual({ stock_on_hand: 2, stock_reserved: 1 });
  });
  it("anon/authenticated cannot call reserve/convert/release/adjust (42501)", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const sql of ["SELECT public.reserve_checkout(gen_random_uuid(), '[]'::jsonb, now())", "SELECT public.release_expired_reservations(now(), 1)",
        "SELECT public.adjust_stock(gen_random_uuid(), 1, 'return', NULL, NULL)", "SELECT public.convert_checkout_to_order(gen_random_uuid(), '{}'::jsonb)"]) {
        const c = await p.connect();
        try { await c.query(`BEGIN; SET LOCAL ROLE ${role}`); await expect(c.query(sql), `${role}: ${sql}`).rejects.toMatchObject({ code: "42501" }); }
        finally { await c.query("ROLLBACK"); c.release(); }
      }
    }
  });
});

describe("0009: expired reservation must not convert", () => {
  it("expired-but-not-yet-swept reservation (expires_at <= paid_at) -> stock_conflict (0009)", async (ctx) => {
    if (!has.convert_checkout_to_order) ctx.skip();
    const v = await seedVariant(p, { onHand: 1 }); const { checkoutId } = await seedCheckout(p, { lines: [[v, 1]] });
    await p.query("SELECT public.reserve_checkout($1,$2::jsonb, now()+interval '35 min')", [checkoutId, items(v, 1)]);
    await p.query("UPDATE stock_reservations SET expires_at = now()-interval '1 min' WHERE checkout_id=$1", [checkoutId]);
    const r = (await p.query("SELECT public.convert_checkout_to_order($1,$2::jsonb) r", [checkoutId, ord(ref())])).rows[0].r;
    expect(r.status).toBe("stock_conflict");
    expect(await stock(v)).toEqual({ stock_on_hand: 1, stock_reserved: 0 });
  });
});
