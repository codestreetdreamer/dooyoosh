// Storage bucket product-images (0004 + 0007): public bucket, no public LISTING, writes only owner/editor admins.
// Supabase emulation: storage.objects with RLS + Supabase default grants; RLS is the only gate (as in Supabase).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "./setup/db.js";

let p; const users = {}; let objName;
beforeAll(async () => {
  p = pool();
  const ok = (await p.query("SELECT 1 FROM storage.buckets WHERE id='product-images'")).rowCount;
  if (!ok) return;
  for (const role of ["owner", "editor", "fulfilment", "customer"]) {
    const id = randomUUID(); users[role] = id;
    await p.query("INSERT INTO auth.users(id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, `${role}-${id.slice(0, 6)}@qa.test`]);
    if (role !== "customer") await p.query("INSERT INTO admin_users(id, role) VALUES ($1, $2::admin_role)", [id, role]);
  }
  objName = `qa/${randomUUID()}.jpg`;
  await p.query("INSERT INTO storage.objects(bucket_id, name, metadata) VALUES ('product-images', $1, '{\"mimetype\":\"image/jpeg\"}')", [objName]);
});
afterAll(() => p.end());

async function as(role, sub, fn) {
  const c = await p.connect();
  try {
    await c.query("BEGIN"); await c.query(`SET LOCAL ROLE ${role}`);
    if (sub) await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [sub]);
    return await fn(c);
  } finally { await c.query("ROLLBACK"); c.release(); }
}
const list = (c) => c.query("SELECT name FROM storage.objects WHERE bucket_id='product-images'").then((r) => r.rows.map((x) => x.name), (e) => e);
const tryWrite = async (c, sql, params) => { try { await c.query("SAVEPOINT s"); const r = await c.query(sql, params); await c.query("RELEASE s"); return r.rowCount; } catch (e) { await c.query("ROLLBACK TO s"); return e.code; } };

describe("storage product-images (0004/0007)", () => {
  it("bucket exists and is PUBLIC (public URL reads bypass RLS), image-only MIME allow-list, size limit set", async (ctx) => {
    const b = (await p.query("SELECT public, allowed_mime_types, file_size_limit FROM storage.buckets WHERE id='product-images'")).rows[0];
    if (!b) ctx.skip("0004 not migrated");
    expect(b.public).toBe(true);
    expect(b.allowed_mime_types.every((m) => m.startsWith("image/"))).toBe(true);
    expect(Number(b.file_size_limit)).toBeGreaterThan(0);
  });
  it("anon cannot LIST objects", async (ctx) => {
    if (!objName) ctx.skip();
    const r = await as("anon", null, list);
    expect(r instanceof Error ? [] : r).not.toContain(objName);
  });
  it("authenticated non-admin (customer) and fulfilment admin cannot LIST objects", async (ctx) => {
    if (!objName) ctx.skip();
    for (const role of ["customer", "fulfilment"]) {
      const r = await as("authenticated", users[role], list);
      expect(r instanceof Error ? [] : r, role).not.toContain(objName);
    }
  });
  it("owner and editor CAN list objects (admin media library)", async (ctx) => {
    if (!objName) ctx.skip();
    for (const role of ["owner", "editor"]) expect(await as("authenticated", users[role], list), role).toContain(objName);
  });
  it("inactive editor cannot list", async (ctx) => {
    if (!objName) ctx.skip();
    await p.query("UPDATE admin_users SET is_active=false WHERE id=$1", [users.editor]);
    try { expect(await as("authenticated", users.editor, list)).not.toContain(objName); }
    finally { await p.query("UPDATE admin_users SET is_active=true WHERE id=$1", [users.editor]); }
  });
  it("anon / customer / fulfilment cannot INSERT, UPDATE or DELETE objects", async (ctx) => {
    if (!objName) ctx.skip();
    for (const [role, sub] of [["anon", null], ["authenticated", users.customer], ["authenticated", users.fulfilment]]) {
      await as(role, sub, async (c) => {
        const ins = await tryWrite(c, "INSERT INTO storage.objects(bucket_id, name) VALUES ('product-images', $1)", [`qa/evil-${randomUUID()}.jpg`]);
        expect(ins, `${role}/${sub} insert`).toBe("42501");
        expect(await tryWrite(c, "UPDATE storage.objects SET name='qa/pwned.jpg' WHERE bucket_id='product-images' AND name=$1", [objName]), `${role} update`).not.toBe(1);
        expect(await tryWrite(c, "DELETE FROM storage.objects WHERE bucket_id='product-images' AND name=$1", [objName]), `${role} delete`).not.toBe(1);
      });
    }
    expect((await p.query("SELECT 1 FROM storage.objects WHERE name=$1", [objName])).rowCount).toBe(1);
  });
  it("editor CAN insert into product-images but not into another bucket", async (ctx) => {
    if (!objName) ctx.skip();
    await p.query("INSERT INTO storage.buckets(id, name, public) VALUES ('qa-private','qa-private',false) ON CONFLICT DO NOTHING");
    await as("authenticated", users.editor, async (c) => {
      expect(await tryWrite(c, "INSERT INTO storage.objects(bucket_id, name) VALUES ('product-images', $1)", [`qa/ok-${randomUUID()}.jpg`])).toBe(1);
      expect(await tryWrite(c, "INSERT INTO storage.objects(bucket_id, name) VALUES ('qa-private', $1)", [`qa/x-${randomUUID()}.jpg`])).toBe("42501");
    });
  });
  it("no SELECT policy on storage.objects for anon (0007 dropped product_images_read)", async (ctx) => {
    const pols = (await p.query("SELECT policyname, roles::text r, cmd FROM pg_policies WHERE schemaname='storage' AND tablename='objects'")).rows;
    if (!pols.length) ctx.skip("no storage policies");
    expect(pols.filter((x) => x.cmd === "SELECT" && /anon/.test(x.r)).map((x) => x.policyname)).toEqual([]);
  });
});
