import pg from "pg";
export const cfg = { host: "127.0.0.1", port: Number(process.env.QA_PG_PORT || 54329), user: "postgres", password: "postgres", database: "qa" };
export const pool = () => new pg.Pool({ ...cfg, max: 30 });
const IKPU = "10000000000000001"; // 17 digits, fake
export async function hasColumn(c, table, col) {
  return (await c.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [table, col])).rowCount > 0;
}
export async function hasFunction(c, name) {
  return (await c.query(`SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1`, [name])).rowCount > 0;
}
export async function seedVariant(c, { onHand, reserved = 0, active = true, price = 125000000 } = {}) {
  const cat = await c.query(`INSERT INTO categories(slug,kind) VALUES ('c-'||gen_random_uuid(),'clothing') RETURNING id`);
  const p = await c.query(`INSERT INTO products(slug,category_id,base_price_cents,currency,size_system,status,published_at,ikpu_code,vat_rate_bp)
     VALUES ('p-'||gen_random_uuid(),$1,$2,'UZS','alpha','published',now(),$3,1200) RETURNING id`, [cat.rows[0].id, price, IKPU]);
  const v = await c.query(`INSERT INTO product_variants(product_id,sku,size,stock_on_hand,stock_reserved,is_active)
     VALUES ($1,'SKU-'||gen_random_uuid(),'M',$2,$3,$4) RETURNING id`, [p.rows[0].id, onHand, reserved, active]);
  return v.rows[0].id;
}
export async function seedShippingMethod(c) {
  const m = await c.query(`INSERT INTO markets(code,currency,is_active) VALUES ('M-'||substr(gen_random_uuid()::text,1,8),'UZS',true) RETURNING id`);
  const sm = await c.query(`INSERT INTO shipping_methods(market_id,code,name,min_days,max_days) VALUES ($1,'std','Std',1,3) RETURNING id`, [m.rows[0].id]);
  return sm.rows[0].id;
}
// lines: [[variantId, quantity, unitPriceMinor?]] -> a real items snapshot + matching subtotal/total, as the
// checkout service writes it (0002 reserve_checkout validates snapshot qty/price and subtotal against the DB).
export async function seedCheckout(c, { total, lines = [], price = 125000000, expiresInMin = 35, shippingMethodId } = {}) {
  const sm = shippingMethodId ?? (await seedShippingMethod(c));
  const snapshot = lines.map(([variantId, quantity, unit = price]) => ({ variantId, sku: `SKU-${variantId.slice(0, 8)}`, productName: "QA product", size: "M", colour: null, quantity, unitPriceMinor: unit, lineTotalMinor: unit * quantity }));
  const subtotal = snapshot.reduce((s, l) => s + l.lineTotalMinor, 0);
  const tot = total ?? (lines.length ? subtotal : 100);
  const cols = ["email", "locale", "currency", "items", "shipping_address", "shipping_method_id", "subtotal_cents", "shipping_cents", "total_cents", "expires_at", "provider"];
  const vals = ["'a@b.c'", "'uz'", "'UZS'", "$2::jsonb", "'{}'", "$1", `${lines.length ? subtotal : tot}`, "0", `${tot}`, `now() + interval '${expiresInMin} min'`, "'mock'"];
  if (await hasColumn(c, "checkouts", "access_token_hash")) { cols.push("access_token_hash"); vals.push("encode(sha256('tok'::bytea),'hex')"); }
  const r = await c.query(`INSERT INTO checkouts(${cols.join(",")}) VALUES (${vals.join(",")}) RETURNING id`, [sm, JSON.stringify(snapshot)]);
  return { checkoutId: r.rows[0].id, shippingMethodId: sm, totalMinor: tot };
}
