// Spec §4 step 1: reservation UPDATE must allow exactly the available quantity under real concurrency.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { cfg, pool, seedVariant } from "./setup/db.js";

const RESERVE = `UPDATE product_variants SET stock_reserved = stock_reserved + $2
  WHERE id = $1 AND is_active AND stock_on_hand - stock_reserved >= $2`;

let p;
beforeAll(() => { p = pool(); });
afterAll(() => p.end());

async function race(variantId, n, qty) {
  const clients = await Promise.all(Array.from({ length: n }, async () => { const c = new pg.Client(cfg); await c.connect(); return c; }));
  await Promise.all(clients.map((c) => c.query("BEGIN")));
  // fire all UPDATEs at once on separate connections, hold the tx open briefly, then commit
  const results = await Promise.all(clients.map(async (c) => {
    try {
      const r = await c.query(RESERVE, [variantId, qty]);
      await c.query("SELECT pg_sleep(0.05)");
      await c.query("COMMIT");
      return r.rowCount;
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); return `err:${e.code}`; }
  }));
  await Promise.all(clients.map((c) => c.end()));
  return results;
}

describe("inventory race (20 concurrent connections, real Postgres 17)", () => {
  it("last 1 unit, 20 buyers x qty 1 -> exactly 1 reservation", async () => {
    const id = await seedVariant(p, { onHand: 1 });
    const r = await race(id, 20, 1);
    expect(r.filter((x) => x === 1)).toHaveLength(1);
    expect(r.filter((x) => typeof x === "string")).toHaveLength(0); // no CHECK errors, losers just get 0 rows
    const { rows } = await p.query("SELECT stock_on_hand, stock_reserved FROM product_variants WHERE id=$1", [id]);
    expect(rows[0]).toEqual({ stock_on_hand: 1, stock_reserved: 1 });
  });
  it("stock 3, 20 buyers x qty 2 -> exactly 1 reservation, reserved=2", async () => {
    const id = await seedVariant(p, { onHand: 3 });
    const r = await race(id, 20, 2);
    expect(r.filter((x) => x === 1)).toHaveLength(1);
    const { rows } = await p.query("SELECT stock_reserved FROM product_variants WHERE id=$1", [id]);
    expect(rows[0].stock_reserved).toBe(2);
  });
  it("stock 5, 20 buyers x qty 1 -> exactly 5 reservations, never oversold", async () => {
    const id = await seedVariant(p, { onHand: 5 });
    const r = await race(id, 20, 1);
    expect(r.filter((x) => x === 1)).toHaveLength(5);
    const { rows } = await p.query("SELECT stock_reserved FROM product_variants WHERE id=$1", [id]);
    expect(rows[0].stock_reserved).toBe(5);
  });
  it("inactive variant can never be reserved", async () => {
    const id = await seedVariant(p, { onHand: 10, active: false });
    const r = await race(id, 5, 1);
    expect(r.every((x) => x === 0)).toBe(true);
  });
  it("DB CHECK is the last line of defence: a naive UPDATE without the guard is rejected", async () => {
    const id = await seedVariant(p, { onHand: 1, reserved: 1 });
    await expect(p.query("UPDATE product_variants SET stock_reserved = stock_reserved + 1 WHERE id=$1", [id]))
      .rejects.toMatchObject({ code: "23514" });
  });
  it("HAZARD (documents, passes when hazard present): negative quantity is not blocked by the spec's UPDATE (code must validate qty > 0)", async () => {
    // Documents a tampering vector: qty=-1 passes the WHERE guard and DEcrements stock_reserved.
    const id = await seedVariant(p, { onHand: 5, reserved: 2 });
    const r = await p.query(RESERVE, [id, -1]);
    expect(r.rowCount).toBe(1);
    const { rows } = await p.query("SELECT stock_reserved FROM product_variants WHERE id=$1", [id]);
    expect(rows[0].stock_reserved).toBe(1); // reservation of another buyer silently freed
  });
});

describe("late conversion after reservation release (spec §4.3 / v0.2 stock_conflict)", () => {
  it("convert after release violates CHECK -> code must route to stock_conflict instead of throwing", async () => {
    const id = await seedVariant(p, { onHand: 1 });
    await p.query(RESERVE, [id, 1]);
    await p.query("UPDATE product_variants SET stock_reserved = stock_reserved - 1 WHERE id=$1", [id]); // expiry cron releases
    await expect(p.query("UPDATE product_variants SET stock_on_hand = stock_on_hand - 1, stock_reserved = stock_reserved - 1 WHERE id=$1", [id]))
      .rejects.toMatchObject({ code: "23514" }); // reserved_nonneg
  });
  it("HAZARD (documents, passes when hazard present): late convert after someone else re-reserved silently steals their unit; CHECK does NOT catch it", async () => {
    const id = await seedVariant(p, { onHand: 1 });
    await p.query(RESERVE, [id, 1]);   // buyer A
    await p.query("UPDATE product_variants SET stock_reserved = stock_reserved - 1 WHERE id=$1", [id]); // A expired
    await p.query(RESERVE, [id, 1]);   // buyer B takes it
    // A's late payment converts blindly: reserved stays 1-1=0? no: B's 1 -1 =0, on_hand 0 -> steals B's unit silently
    const r = await p.query("UPDATE product_variants SET stock_on_hand = stock_on_hand - 1, stock_reserved = stock_reserved - 1 WHERE id=$1", [id]);
    expect(r.rowCount).toBe(1); // DOCUMENTED HAZARD: CHECK does NOT catch this; B's reservation is consumed by A.
    // => conversion MUST be gated on stock_reservations.status='active' for that checkout (row-locked), not on variant counters.
  });
});
