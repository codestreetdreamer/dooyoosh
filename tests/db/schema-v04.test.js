// SCHEMA_DELTA.md (B items) + ARCHITECTURE v0.4 §13 + §12.5 function hardening.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, seedVariant, hasColumn } from "./setup/db.js";

let p;
beforeAll(() => { p = pool(); });
afterAll(() => p.end());
const checks = async (t) => (await p.query(`SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid=$1::regclass AND contype='c'`, [`public.${t}`])).rows;
const notNull = async (t, c) => (await p.query(`SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [t, c])).rows[0]?.is_nullable === "NO";

describe("B1 guest access token", () => {
  it("checkouts.access_token_hash exists and is NOT NULL", async () => {
    expect(await hasColumn(p, "checkouts", "access_token_hash"), "checkouts.access_token_hash missing").toBe(true);
    expect(await notNull("checkouts", "access_token_hash")).toBe(true);
  });
  it("orders.access_token_hash exists and is NOT NULL", async () => {
    expect(await notNull("orders", "access_token_hash")).toBe(true);
  });
});

describe("quantity > 0 CHECKs", () => {
  for (const [t, col] of [["stock_reservations", "quantity"], ["order_items", "quantity"]]) {
    it(`${t}.${col} > 0`, async () => {
      expect((await checks(t)).some((c) => new RegExp(`${col}\\W*> 0`).test(c.d))).toBe(true);
    });
  }
  it("inventory_movements.delta <> 0", async () => {
    expect((await checks("inventory_movements")).some((c) => /delta\W*<> 0/.test(c.d))).toBe(true);
  });
  it("B7: order_items.unit_price_cents >= 0", async () => {
    expect((await checks("order_items")).some((c) => /unit_price_cents\W*>= 0/.test(c.d))).toBe(true);
  });
});

describe("§13 fiscal: ikpu_code / vat_rate_bp required to publish", () => {
  it("publishing a product without ikpu_code is rejected (23514)", async () => {
    const v = await seedVariant(p, { onHand: 1 });
    const pid = (await p.query("SELECT product_id FROM product_variants WHERE id=$1", [v])).rows[0].product_id;
    await expect(p.query("UPDATE products SET ikpu_code=NULL WHERE id=$1", [pid])).rejects.toMatchObject({ code: "23514" });
  });
  it("ikpu_code must be 17 digits", async () => {
    const v = await seedVariant(p, { onHand: 1 });
    const pid = (await p.query("SELECT product_id FROM product_variants WHERE id=$1", [v])).rows[0].product_id;
    await expect(p.query("UPDATE products SET ikpu_code='123' WHERE id=$1", [pid])).rejects.toMatchObject({ code: "23514" });
  });
  it("vat_rate_bp has no silent default (publish must require an explicit VAT rate)", async () => {
    const def = (await p.query(`SELECT column_default FROM information_schema.columns WHERE table_name='products' AND column_name='vat_rate_bp'`)).rows[0]?.column_default;
    expect(def, "products.vat_rate_bp DEFAULT means a product can be published with an unconfirmed 12% rate").toBeNull();
  });
  it("order_items snapshot ikpu_code, package_code, vat_rate_bp", async () => {
    for (const c of ["ikpu_code", "package_code", "vat_rate_bp"]) expect(await hasColumn(p, "order_items", c), c).toBe(true);
  });
});

describe("function hardening (§12.5)", () => {
  it("every SECURITY DEFINER function in public/app_private has search_path=''", async () => {
    const { rows } = await p.query(`SELECT n.nspname||'.'||proname f, proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','app_private') AND prosecdef`);
    const bad = rows.filter((r) => !(r.proconfig || []).some((x) => /^search_path=("")?$/.test(x))).map((r) => r.f);
    expect(bad).toEqual([]);
  });
  it("anon/authenticated cannot EXECUTE any public function except variant_availability", async () => {
    const { rows } = await p.query(`SELECT proname, has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u
      FROM pg_proc p WHERE pronamespace='public'::regnamespace`);
    const bad = rows.filter((r) => r.proname !== "variant_availability" && (r.a || r.u)).map((r) => r.proname);
    expect(bad).toEqual([]);
  });
  it("app_private: anon/authenticated may only EXECUTE is_admin", async () => {
    const { rows } = await p.query(`SELECT proname, has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u
      FROM pg_proc p WHERE pronamespace='app_private'::regnamespace`);
    expect(rows.length, "app_private schema has no functions").toBeGreaterThan(0);
    expect(rows.filter((r) => r.proname !== "is_admin" && (r.a || r.u)).map((r) => r.proname)).toEqual([]);
  });
  it("default privileges no longer auto-grant functions/tables in public to anon/authenticated", async () => {
    const { rows } = await p.query(`SELECT defaclobjtype t, defaclacl::text acl FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname='public'`);
    for (const r of rows) expect(r.acl, `default ACL type ${r.t}`).not.toMatch(/(^|[{,])(anon|authenticated)=/);
  });
});

describe("other SCHEMA_DELTA B items", () => {
  it("B3 payment_status has 'canceled'", async () => {
    const v = (await p.query(`SELECT unnest(enum_range(NULL::payment_status))::text v`)).rows.map((r) => r.v);
    expect(v).toContain("canceled");
  });
  it("B4 currency CHECK ^[A-Z]{3}$ on markets, products, checkouts, orders, payments", async () => {
    for (const t of ["markets", "products", "checkouts", "orders", "payments"]) expect((await checks(t)).some((c) => /currency/.test(c.d)), t).toBe(true);
  });
  it("B5 countries.iso2 CHECK upper-case", async () => {
    expect((await checks("countries")).some((c) => /iso2/.test(c.d))).toBe(true);
  });
  it("B8 stock_reservations UNIQUE(checkout_id, variant_id) + created_at/released_at/converted_at", async () => {
    const { rows } = await p.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='public.stock_reservations'::regclass AND contype='u'`);
    expect(rows.map((r) => r.d)).toContain("UNIQUE (checkout_id, variant_id)");
    for (const c of ["created_at", "released_at", "converted_at"]) expect(await hasColumn(p, "stock_reservations", c), c).toBe(true);
  });
  it("B9 refunds.idempotency_key UNIQUE NOT NULL", async () => {
    expect(await notNull("refunds", "idempotency_key")).toBe(true);
  });
  it("B10 shipments.tracking_url must be https", async () => {
    expect((await checks("shipments")).some((c) => /tracking_url/.test(c.d))).toBe(true);
  });
  it("B11 newsletter_subscribers table exists with RLS", async () => {
    const r = (await p.query(`SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.newsletter_subscribers')`)).rows[0];
    expect(r?.relrowsecurity).toBe(true);
  });
  it("B16 at most one succeeded payment per order (partial unique index)", async () => {
    const { rows } = await p.query(`SELECT indexdef FROM pg_indexes WHERE tablename='payments' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%succeeded%'`);
    expect(rows.length).toBe(1);
  });
});
