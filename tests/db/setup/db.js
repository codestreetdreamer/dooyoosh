import pg from "pg";
export const cfg = { host: "127.0.0.1", port: 54329, user: "postgres", password: "postgres", database: "qa" };
export const pool = () => new pg.Pool({ ...cfg, max: 30 });
export async function seedVariant(c, { onHand, reserved = 0, active = true } = {}) {
  const cat = await c.query(`INSERT INTO categories(slug,kind) VALUES ('c-'||gen_random_uuid(),'clothing') RETURNING id`);
  const p = await c.query(`INSERT INTO products(slug,category_id,base_price_cents,currency,size_system,status)
     VALUES ('p-'||gen_random_uuid(),$1,125000000,'UZS','alpha','published') RETURNING id`, [cat.rows[0].id]);
  const v = await c.query(`INSERT INTO product_variants(product_id,sku,size,stock_on_hand,stock_reserved,is_active)
     VALUES ($1,'SKU-'||gen_random_uuid(),'M',$2,$3,$4) RETURNING id`, [p.rows[0].id, onHand, reserved, active]);
  return v.rows[0].id;
}
