// Spec §3 (+ v0.2, v0.3 §12) vs actual migrations applied to fresh Postgres 17.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "./setup/db.js";

let p;
beforeAll(() => { p = pool(); });
afterAll(() => p.end());

const SPEC = {
  categories: "id slug parent_id kind sort_order is_active",
  category_translations: "category_id locale name description",
  products: "id slug category_id brand status base_price_cents currency size_system size_chart_id published_at archived_at created_at updated_at",
  product_translations: "product_id locale name description materials care fit_notes seo_title seo_description",
  product_images: "id product_id variant_id storage_path alt sort_order width height",
  product_variants: "id product_id sku size colour colour_hex price_cents stock_on_hand stock_reserved is_active weight_grams created_at updated_at",
  size_charts: "id name size_system data",
  inventory_movements: "id variant_id delta reason order_id note actor_id created_at",
  stock_reservations: "id variant_id checkout_id quantity expires_at status",
  markets: "id code currency is_active",
  countries: "iso2 market_id is_shippable",
  shipping_methods: "id market_id code name min_days max_days is_active",
  shipping_rates: "id shipping_method_id min_subtotal_cents max_weight_grams price_cents free_over_cents",
  checkouts: "id email locale currency items shipping_address shipping_method_id subtotal_cents shipping_cents tax_cents total_cents provider provider_session_id status expires_at created_at",
  orders: "id reference checkout_id email phone locale currency subtotal_cents shipping_cents tax_cents discount_cents total_cents status shipping_address billing_address shipping_method_id access_token_hash placed_at paid_at created_at updated_at",
  order_items: "id order_id variant_id sku product_name size colour unit_price_cents quantity line_total_cents",
  order_events: "id order_id type from_status to_status payload actor_id created_at",
  payments: "id order_id provider provider_payment_id amount_cents currency status raw created_at",
  refunds: "id payment_id amount_cents reason provider_refund_id status created_at",
  shipments: "id order_id carrier tracking_number tracking_url status shipped_at delivered_at",
  payment_events: "provider event_id type received_at processed_at error",
  articles: "id slug status cover_image_path author_name published_at created_at updated_at",
  article_translations: "article_id locale title excerpt body seo_title seo_description",
  article_products: "article_id product_id sort_order",
  tags: "id slug name",
  article_tags: "article_id tag_id",
  admin_users: "id role is_active",
  audit_log: "id actor_id action entity entity_id diff created_at",
};
const ENUMS = {
  category_kind: "clothing footwear accessories",
  product_status: "draft published archived",
  size_system: "alpha eu_shoe uk_shoe us_shoe one_size numeric",
  inventory_movement_reason: "restock adjustment sale cancellation return damage",
  stock_reservation_status: "active converted released",
  checkout_status: "open awaiting_payment completed expired failed",
  order_status: "pending_payment paid stock_conflict fulfilling shipped delivered cancelled refunded partially_refunded",
  payment_status: "requires_payment succeeded failed canceled refunded partially_refunded", // canceled = SCHEMA_DELTA B3
  shipment_status: "label_created in_transit delivered exception",
  article_status: "draft scheduled published archived",
  admin_role: "owner editor fulfilment",
};

async function cols(t) {
  return (await p.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [t])).rows;
}

describe("schema vs spec §3", () => {
  for (const [t, c] of Object.entries(SPEC)) {
    it(`table ${t} has spec columns`, async () => {
      const got = (await cols(t)).map((r) => r.column_name);
      expect(got.length, `table ${t} missing`).toBeGreaterThan(0);
      const missing = c.split(" ").filter((x) => !got.includes(x));
      expect(missing, `${t} missing columns`).toEqual([]);
    });
  }
  for (const [e, v] of Object.entries(ENUMS)) {
    it(`enum ${e} matches spec`, async () => {
      const got = (await p.query(`SELECT unnest(enum_range(NULL::${e}))::text v`)).rows.map((r) => r.v);
      expect(got.sort()).toEqual(v.split(" ").sort());
    });
  }
  it("money columns (*_cents) are integer/bigint, never float/numeric", async () => {
    const { rows } = await p.query(`SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' AND column_name LIKE '%cents%'`);
    expect(rows.length).toBeGreaterThan(10);
    const bad = rows.filter((r) => !["integer", "bigint"].includes(r.data_type));
    expect(bad).toEqual([]);
    const floats = (await p.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND data_type IN ('real','double precision','numeric','money')`)).rows;
    expect(floats).toEqual([]);
  });
  it("UZS headroom: order/checkout totals use bigint (int4 max = 21,474,836.47 so'm in tiyin)", async () => {
    const intCols = (await p.query(`SELECT table_name||'.'||column_name c FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('orders','checkouts','payments') AND column_name IN ('total_cents','subtotal_cents','amount_cents') AND data_type='integer'`)).rows.map((r) => r.c);
    expect(intCols, "these overflow above ~21.5M so'm").toEqual([]);
  });
  it("money columns default to correct currency for UZ business (no hardcoded 'EUR' default)", async () => {
    const { rows } = await p.query(`SELECT table_name, column_name, column_default FROM information_schema.columns
      WHERE table_schema='public' AND column_name='currency' AND column_default ILIKE '%EUR%'`);
    expect(rows).toEqual([]);
  });
  it("product_variants CHECKs: stock_on_hand>=0, stock_reserved>=0, reserved<=on_hand, UNIQUE sku, UNIQUE(product,size,colour)", async () => {
    const { rows } = await p.query(`SELECT conname FROM pg_constraint WHERE conrelid='public.product_variants'::regclass`);
    const n = rows.map((r) => r.conname);
    for (const c of ["product_variants_on_hand_nonneg", "product_variants_reserved_nonneg", "product_variants_reserved_le_on_hand", "product_variants_sku_unique", "product_variants_product_size_colour_uq"]) expect(n).toContain(c);
  });
  it("orders.reference UNIQUE and orders.checkout_id UNIQUE", async () => {
    const { rows } = await p.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='public.orders'::regclass AND contype='u'`);
    const d = rows.map((r) => r.d);
    expect(d).toContain("UNIQUE (reference)");
    expect(d).toContain("UNIQUE (checkout_id)");
  });
  it("payments.provider not hardcoded to stripe (no 'stripe' default, enum allows payme/click)", async () => {
    const def = (await p.query(`SELECT column_default FROM information_schema.columns WHERE table_name='payments' AND column_name='provider'`)).rows[0]?.column_default;
    expect(def ?? "", "payments.provider default").not.toMatch(/stripe/);
    const vals = (await p.query(`SELECT unnest(enum_range(NULL::payment_provider))::text v`)).rows.map((r) => r.v);
    expect(vals).toEqual(expect.arrayContaining(["payme", "click"]));
  });
  it("stock_reservations: one active reservation per (checkout_id, variant_id)", async () => {
    const { rows } = await p.query(`SELECT indexdef FROM pg_indexes WHERE tablename='stock_reservations' AND indexdef ILIKE '%UNIQUE%'`);
    expect(rows.some((r) => /checkout_id/.test(r.indexdef) && /variant_id/.test(r.indexdef))).toBe(true);
  });
  it("v0.3 §12.2: checkouts UNIQUE(provider, provider_session_id)", async () => {
    const { rows } = await p.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='public.checkouts'::regclass AND contype='u'`);
    expect(rows.map((r) => r.d)).toContain("UNIQUE (provider, provider_session_id)");
  });
  it("v0.3 §12.5: stock SECURITY DEFINER functions exist, search_path='' , EXECUTE only for service_role", async () => {
    const want = ["reserve_checkout", "convert_checkout_to_order", "release_checkout", "release_expired_reservations", "adjust_stock"];
    const { rows } = await p.query(`SELECT proname, prosecdef, proconfig,
        has_function_privilege('anon', oid, 'EXECUTE') anon_x, has_function_privilege('authenticated', oid, 'EXECUTE') auth_x
      FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [want]);
    expect(rows.map((r) => r.proname).sort(), "missing stock functions").toEqual(want.sort());
    for (const r of rows) {
      expect(r.prosecdef, r.proname).toBe(true);
      expect((r.proconfig || []).join(","), r.proname).toMatch(/search_path=("")?$/);
      expect([r.anon_x, r.auth_x], r.proname).toEqual([false, false]);
    }
  });
  it("v0.3 §12.6: public read views over published catalog use security_invoker=on", async () => {
    const { rows } = await p.query(`SELECT c.relname, c.reloptions FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='v'`);
    expect(rows.length, "no public views exist yet").toBeGreaterThan(0);
    for (const r of rows) expect((r.reloptions || []).join(","), r.relname).toMatch(/security_invoker=(on|true)/);
  });
  it("admin_users.id has FK to auth.users (comment says it's added in hand-written migration)", async () => {
    const { rows } = await p.query(`SELECT 1 FROM pg_constraint WHERE conrelid='public.admin_users'::regclass AND contype='f'`);
    expect(rows.length).toBe(1);
  });
});
