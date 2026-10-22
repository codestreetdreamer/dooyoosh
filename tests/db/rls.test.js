// Spec §2: "Row Level Security ON for all tables. Public reads only via server code or views."
// Simulates Supabase: anon/authenticated have table GRANTs (Supabase default), RLS is the only gate.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, seedVariant } from "./setup/db.js";

let p;
beforeAll(() => { p = pool(); });
afterAll(() => p.end());

async function as(role, sub, fn) {
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SET LOCAL ROLE ${role}`);
    if (sub) await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [sub]);
    return await fn(c);
  } finally { await c.query("ROLLBACK"); c.release(); }
}

describe("RLS", () => {
  it("every public table has RLS enabled", async () => {
    const { rows } = await p.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity ORDER BY 1`);
    expect(rows.map((r) => r.relname), "tables WITHOUT RLS").toEqual([]);
  });
  it("anon cannot read orders (PII: email, phone, addresses)", async () => {
    const n = await as("anon", null, async (c) => {
      try { return (await c.query("SELECT count(*)::int n FROM orders")).rows[0].n; } catch { return "denied"; }
    });
    const total = (await p.query("SELECT count(*)::int n FROM orders")).rows[0].n;
    expect(total, "need at least one order seeded by webhook test").toBeGreaterThan(0);
    expect(n === "denied" || n === 0).toBe(true);
  });
  it("anon cannot write product_variants stock (e.g. set stock_reserved=0)", async () => {
    const id = await seedVariant(p, { onHand: 5, reserved: 3 });
    const res = await as("anon", null, async (c) => {
      try { return (await c.query("UPDATE product_variants SET stock_reserved=0 WHERE id=$1", [id])).rowCount; } catch { return "denied"; }
    });
    expect(res === "denied" || res === 0).toBe(true);
  });
  it("authenticated user cannot self-assign admin role (INSERT into admin_users with own uid)", async () => {
    const uid = "11111111-1111-1111-1111-111111111111";
    await p.query("INSERT INTO auth.users(id) VALUES ($1) ON CONFLICT DO NOTHING", [uid]); // so the FK can't mask the result
    const res = await as("authenticated", uid, async (c) => {
      try { return (await c.query("INSERT INTO admin_users(id, role) VALUES ($1,'owner')", [uid])).rowCount; } catch (e) { return e.code === "23503" ? "fk-masked" : "denied"; }
    });
    expect(res).toBe("denied");
  });
  it("authenticated user cannot UPDATE own profiles row into an admin (no role/is_admin column writable)", async () => {
    const uid = "33333333-3333-3333-3333-333333333333";
    await p.query("INSERT INTO auth.users(id, email) VALUES ($1,'x@y.z') ON CONFLICT DO NOTHING", [uid]);
    const cols = (await p.query(`SELECT column_name FROM information_schema.columns WHERE table_name='profiles'`)).rows.map((r) => r.column_name);
    expect(cols.filter((c) => /role|admin/.test(c)), "profiles must not carry authz columns").toEqual([]);
  });
  it("authenticated user cannot read other users' profiles", async () => {
    await p.query("INSERT INTO auth.users(id, email) VALUES ('44444444-4444-4444-4444-444444444444','o@y.z') ON CONFLICT DO NOTHING");
    const n = await as("authenticated", "55555555-5555-5555-5555-555555555555", async (c) => {
      try { return (await c.query("SELECT count(*)::int n FROM profiles")).rows[0].n; } catch { return "denied"; }
    });
    expect(n === "denied" || n === 0).toBe(true);
  });
  it("anon cannot read draft products", async () => {
    await seedVariant(p, { onHand: 1 });
    await p.query("UPDATE products SET status='draft' WHERE id=(SELECT id FROM products LIMIT 1)");
    const n = await as("anon", null, async (c) => {
      try { return (await c.query("SELECT count(*)::int n FROM products WHERE status<>'published'")).rows[0].n; } catch { return "denied"; }
    });
    expect(n === "denied" || n === 0).toBe(true);
  });
  it("anon cannot insert a fake payment_event / webhook_event to pre-empt a real one", async () => {
    const res = await as("anon", null, async (c) => {
      try { return (await c.query("INSERT INTO payment_events(provider,event_id,type) VALUES ('payme','evt_attacker','x')")).rowCount; } catch { return "denied"; }
    });
    expect(res).toBe("denied");
  });
  it("policy inventory (informational): number of policies defined", async () => {
    const { rows } = await p.query("SELECT count(*)::int n FROM pg_policies WHERE schemaname='public'");
    expect(rows[0].n, "no RLS policies exist yet").toBeGreaterThan(0);
  });
});

describe("inventory_movements append-only", () => {
  it("UPDATE and DELETE are blocked even for the app's owner role (trigger or REVOKE)", async () => {
    const v = await seedVariant(p, { onHand: 1 });
    const { rows } = await p.query(`INSERT INTO inventory_movements(variant_id,delta,reason) VALUES ($1,1,'restock') RETURNING id`, [v]);
    const upd = await p.query("UPDATE inventory_movements SET delta=999 WHERE id=$1", [rows[0].id]).then((r) => r.rowCount, () => "blocked");
    const del = await p.query("DELETE FROM inventory_movements WHERE id=$1", [rows[0].id]).then((r) => r.rowCount, () => "blocked");
    expect({ upd, del }).toEqual({ upd: "blocked", del: "blocked" });
  });
  it("authenticated/anon cannot UPDATE/DELETE inventory_movements", async () => {
    const v = await seedVariant(p, { onHand: 1 });
    const { rows } = await p.query(`INSERT INTO inventory_movements(variant_id,delta,reason) VALUES ($1,1,'restock') RETURNING id`, [v]);
    const r = await as("authenticated", "22222222-2222-2222-2222-222222222222", (c) =>
      c.query("DELETE FROM inventory_movements WHERE id=$1", [rows[0].id]).then((x) => x.rowCount, () => "blocked"));
    expect(r === "blocked" || r === 0).toBe(true);
  });
});
