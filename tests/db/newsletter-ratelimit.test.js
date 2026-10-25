// 0008 newsletter_attempts + public.newsletter_attempt(): DB-backed rate limit shared by all app instances.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import { cfg, pool, hasFunction } from "./setup/db.js";

let p; let has = false;
const h = (s) => createHash("sha256").update(s).digest("hex");
const SIG = "text, text, int, interval, int, interval";
beforeAll(async () => { p = pool(); has = await hasFunction(p, "newsletter_attempt"); });
afterAll(() => p.end());
// every call on its own connection = a separate serverless "instance"
async function attempt(ip, email, extra = "") {
  const c = new pg.Client(cfg); await c.connect();
  try { return (await c.query(`SELECT public.newsletter_attempt($1, $2${extra}) ok`, [ip, email])).rows[0].ok; } finally { await c.end(); }
}
async function asRole(role, sql, params = []) {
  const c = await p.connect();
  try { await c.query(`BEGIN; SET LOCAL ROLE ${role}`); await c.query(sql, params); return "ok"; } catch (e) { return e.code; } finally { await c.query("ROLLBACK"); c.release(); }
}

describe("0008 newsletter rate limit", () => {
  it("table: RLS on, no direct access for anon / authenticated / service_role", async (ctx) => {
    if (!has) ctx.skip("0008 not migrated");
    expect((await p.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.newsletter_attempts'::regclass")).rows[0].relrowsecurity).toBe(true);
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(await asRole(role, "SELECT * FROM public.newsletter_attempts"), `${role} select`).toBe("42501");
      expect(await asRole(role, "INSERT INTO public.newsletter_attempts(email_hash) VALUES ($1)", [h("x")]), `${role} insert`).toBe("42501");
      expect(await asRole(role, "DELETE FROM public.newsletter_attempts"), `${role} delete (reset the limiter)`).toBe("42501");
    }
  });
  it("function: SECURITY DEFINER, search_path='', EXECUTE only service_role", async (ctx) => {
    if (!has) ctx.skip();
    const f = (await p.query(`SELECT prosecdef, proconfig,
      has_function_privilege('anon', oid, 'EXECUTE') a, has_function_privilege('authenticated', oid, 'EXECUTE') u, has_function_privilege('service_role', oid, 'EXECUTE') s
      FROM pg_proc WHERE oid = 'public.newsletter_attempt(${SIG})'::regprocedure`)).rows[0];
    expect(f.prosecdef).toBe(true);
    expect(f.proconfig.some((x) => /^search_path=("")?$/.test(x))).toBe(true);
    expect([f.a, f.u, f.s]).toEqual([false, false, true]);
    expect(await asRole("anon", "SELECT public.newsletter_attempt($1,$2)", [h("i"), h("e")])).toBe("42501");
    expect(await asRole("authenticated", "SELECT public.newsletter_attempt($1,$2)", [h("i"), h("e")])).toBe("42501");
  });
  it("per-email limit (3/h) holds across separate connections ('instances')", async (ctx) => {
    if (!has) ctx.skip();
    const e = h(`e-${randomUUID()}`); const res = [];
    for (let i = 0; i < 5; i++) res.push(await attempt(h(`ip-${randomUUID()}`), e)); // different IP each time
    expect(res).toEqual([true, true, true, false, false]);
  });
  it("per-IP limit (10/10min) holds across instances; rotating emails does not bypass it", async (ctx) => {
    if (!has) ctx.skip();
    const ip = h(`ip-${randomUUID()}`); const res = [];
    for (let i = 0; i < 12; i++) res.push(await attempt(ip, h(`e-${randomUUID()}`)));
    expect(res.filter(Boolean)).toHaveLength(10);
    expect(res.slice(10)).toEqual([false, false]);
  });
  it("20 concurrent attempts for one email -> exactly 3 allowed (advisory locks, no race)", async (ctx) => {
    if (!has) ctx.skip();
    const e = h(`e-${randomUUID()}`);
    const res = await Promise.all(Array.from({ length: 20 }, () => attempt(h(`ip-${randomUUID()}`), e)));
    expect(res.filter(Boolean)).toHaveLength(3);
  });
  it("20 concurrent attempts from one IP with distinct emails -> exactly 10 allowed", async (ctx) => {
    if (!has) ctx.skip();
    const ip = h(`ip-${randomUUID()}`);
    const res = await Promise.all(Array.from({ length: 20 }, () => attempt(ip, h(`e-${randomUUID()}`))));
    expect(res.filter(Boolean)).toHaveLength(10);
  });
  it("NULL ip (no trusted header) -> per-email limit still applies", async (ctx) => {
    if (!has) ctx.skip();
    const e = h(`e-${randomUUID()}`); const res = [];
    for (let i = 0; i < 4; i++) res.push(await attempt(null, e));
    expect(res).toEqual([true, true, true, false]);
  });
  it("only 64-hex hashes are stored: plain IP / plain email are rejected (function + table CHECK)", async (ctx) => {
    if (!has) ctx.skip();
    await expect(attempt("203.0.113.7", h("e"))).rejects.toMatchObject({ code: "P0001", message: "VALIDATION_ERROR" });
    await expect(attempt(h("i"), "victim@example.com")).rejects.toMatchObject({ code: "P0001" });
    await expect(attempt(h("i").toUpperCase(), h("e"))).rejects.toMatchObject({ code: "P0001" });
    await expect(p.query("INSERT INTO public.newsletter_attempts(ip_hash, email_hash) VALUES ('203.0.113.7', $1)", [h("e")])).rejects.toMatchObject({ code: "23514" });
    const plain = await p.query(`SELECT count(*)::int n FROM public.newsletter_attempts WHERE ip_hash !~ '^[0-9a-f]{64}$' OR email_hash !~ '^[0-9a-f]{64}$' OR email_hash LIKE '%@%'`);
    expect(plain.rows[0].n).toBe(0);
  });
  it("caller cannot widen the limits: limit < 1 or window > 24h rejected", async (ctx) => {
    if (!has) ctx.skip();
    await expect(attempt(h("i"), h("e"), ", 0")).rejects.toMatchObject({ code: "P0001" });
    await expect(attempt(h("i"), h("e"), ", 10, interval '25 hours'")).rejects.toMatchObject({ code: "P0001" });
  });
  it("rows older than 24h are pruned on the next call", async (ctx) => {
    if (!has) ctx.skip();
    const e = h(`old-${randomUUID()}`);
    await p.query("INSERT INTO public.newsletter_attempts(email_hash, created_at) VALUES ($1, now() - interval '25 hours')", [e]);
    await attempt(null, h(`e-${randomUUID()}`));
    expect((await p.query("SELECT count(*)::int n FROM public.newsletter_attempts WHERE email_hash=$1", [e])).rows[0].n).toBe(0);
  });
});
