// Spec §4.3 + v0.2 §11: dedupe via payment_events(provider, event_id); duplicate delivery must never create a 2nd order.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { cfg, pool, seedCheckout } from "./setup/db.js";

let p;
beforeAll(() => { p = pool(); });
afterAll(() => p.end());
const tableExists = async (t) => (await p.query("SELECT to_regclass($1) AS r", [`public.${t}`])).rows[0].r !== null;

describe("webhook / callback idempotency", () => {
  it("v0.2: table payment_events exists with PK(provider, event_id)", async () => {
    expect(await tableExists("payment_events")).toBe(true);
    const { rows } = await p.query(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid='public.payment_events'::regclass AND i.indisprimary ORDER BY a.attname`);
    expect(rows.map((r) => r.attname)).toEqual(["event_id", "provider"]);
  });

  it("payment_events: same event inserted twice -> second is a no-op (ON CONFLICT DO NOTHING rowCount 0)", async () => {
    const ins = `INSERT INTO payment_events(provider, event_id, type) VALUES ('payme',$1,'PerformTransaction') ON CONFLICT DO NOTHING`;
    expect((await p.query(ins, ["evt_dup_1"])).rowCount).toBe(1);
    expect((await p.query(ins, ["evt_dup_1"])).rowCount).toBe(0);
    await expect(p.query(`INSERT INTO payment_events(provider, event_id, type) VALUES ('payme','evt_dup_1','x')`)).rejects.toMatchObject({ code: "23505" });
  });

  it("10 concurrent deliveries of the same event -> exactly 1 insert wins", async () => {
    const clients = await Promise.all(Array.from({ length: 10 }, async () => { const c = new pg.Client(cfg); await c.connect(); return c; }));
    const res = await Promise.all(clients.map((c) => c.query(`INSERT INTO payment_events(provider, event_id, type) VALUES ('click','evt_conc_1','t') ON CONFLICT DO NOTHING`)));
    await Promise.all(clients.map((c) => c.end()));
    expect(res.reduce((s, r) => s + r.rowCount, 0)).toBe(1);
  });

  it("same event id from two different providers must both be accepted (PK must include provider)", async () => {
    // Payme transaction ids and Click click_trans_id are independent namespaces.
    const vals = (await p.query(`SELECT unnest(enum_range(NULL::payment_provider))::text v`)).rows.map((r) => r.v);
    expect(vals.length, `payment_provider enum only has: ${vals}`).toBeGreaterThanOrEqual(2);
    await p.query(`INSERT INTO payment_events(provider, event_id, type) VALUES ($1,'shared_1','t')`, [vals[0]]);
    await expect(p.query(`INSERT INTO payment_events(provider, event_id, type) VALUES ($1,'shared_1','t')`, [vals[1]])).resolves.toBeTruthy();
  });

  it("second order for the same checkout is rejected by orders.checkout_id UNIQUE", async () => {
    const { checkoutId, shippingMethodId } = await seedCheckout(p);
    const co = { rows: [{ id: checkoutId }] }; const sm = { rows: [{ id: shippingMethodId }] };
    const ord = `INSERT INTO orders(reference,checkout_id,email,locale,currency,subtotal_cents,shipping_cents,total_cents,shipping_address,shipping_method_id,access_token_hash)
      VALUES ($1,$2,'a@b.c','uz','UZS',100,0,100,'{}',$3,repeat('ab',32))`;
    await p.query(ord, ["DY-20261022-ABCDE", co.rows[0].id, sm.rows[0].id]);
    await expect(p.query(ord, ["DY-20261022-ABCDF", co.rows[0].id, sm.rows[0].id])).rejects.toMatchObject({ code: "23505" });
    await expect(p.query(ord.replace("$2", "gen_random_uuid()").replace("$3", "$2"), ["DY-20261022-ABCDE", sm.rows[0].id]))
      .rejects.toBeTruthy(); // duplicate reference (or FK) rejected
  });

  it("payments UNIQUE(provider, provider_payment_id)", async () => {
    const { rows } = await p.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='public.payments'::regclass AND contype='u'`);
    expect(rows.map((r) => r.d)).toContain("UNIQUE (provider, provider_payment_id)");
  });
  it("refunds.provider_refund_id uniqueness scoped per provider (refunds has no provider column; Payme/Click ids may collide)", async () => {
    const { rows } = await p.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='public.refunds'::regclass AND contype='u'`);
    expect(rows.map((r) => r.d)).not.toContain("UNIQUE (provider_refund_id)");
  });
});
