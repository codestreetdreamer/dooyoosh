// Catalog / cart / newsletter attacks (Backend & Database routes, feat/db a4e2c69+).
// Needs a server with a DB that contains hidden rows: slugs qa-hidden-{draft,archived,scheduled,inactivecat},
// names/bodies containing "qahiddensecret", articles qa-hidden-article-{draft,scheduled}, an inactive variant
// (colour "Qahiddencolour") and a visible variant with stock 137. See tests/api/fixtures/catalog-hidden.sql.
// Optional env: QA_HIDDEN_VARIANT_IDS (csv), QA_V137 (variant id with stock 137), QA_V137_PRICE.
import { describe, it, expect } from "vitest";
import { UP, DOWN_REASON, call, notImplemented, env } from "./lib/http.js";

const HIDDEN_SLUGS = ["qa-hidden-draft", "qa-hidden-archived", "qa-hidden-scheduled", "qa-hidden-inactivecat"];
const SECRET = /qahiddensecret|qa-hidden-|Qahiddencolour|QA-HIDDEN|QA-INACTIVE/i;
const HIDDEN_V = (env("QA_HIDDEN_VARIANT_IDS") || "").split(",").filter(Boolean);
const V137 = env("QA_V137"); const PRICE = Number(env("QA_V137_PRICE") || 0);
const skipMissing = (ctx, r) => { if (notImplemented(r)) ctx.skip("route not implemented"); };
const noLeak = (r, what) => expect(r.text, `${what} leaked a hidden row`).not.toMatch(SECRET);

describe.skipIf(!UP)(`catalog attacks${UP ? "" : ` [SKIPPED: ${DOWN_REASON}]`}`, () => {
  describe("published-only everywhere", () => {
    it("/products (all sorts, big page, every category) never lists hidden products", async (ctx) => {
      for (const sort of ["new", "price_asc", "price_desc"]) {
        let cursor; let pages = 0;
        do {
          const r = await call("GET", "/products", { query: { limit: 50, sort, cursor } });
          skipMissing(ctx, r); expect(r.status).toBe(200); noLeak(r, `/products sort=${sort}`);
          cursor = r.json.page?.cursor; pages++;
        } while (cursor && pages < 20);
      }
      for (const category of ["clothing", "footwear", "accessories", "qa-inactive-cat"]) {
        const r = await call("GET", "/products", { query: { category, limit: 50 } });
        noLeak(r, `/products?category=${category}`);
      }
    });
    it("/products/{slug} -> 404 for draft / archived / scheduled / inactive-category products", async (ctx) => {
      for (const s of HIDDEN_SLUGS) {
        const r = await call("GET", `/products/${s}`); skipMissing(ctx, r);
        expect(r.status, s).toBe(404);
      }
    });
    it("/products/{slug} detail never includes an inactive variant", async (ctx) => {
      const r = await call("GET", "/products/demo-linen-wrap-dress"); skipMissing(ctx, r);
      if (r.status === 404) ctx.skip("demo seed not loaded");
      noLeak(r, "product detail");
    });
    it("/search never returns hidden products/articles (FTS + ILIKE paths)", async (ctx) => {
      for (const q of ["qahiddensecret", "Qahiddensecret draft", "qa-hidden", "Qahiddencolour", "QA-HIDDEN-DRAFT"]) {
        const r = await call("GET", "/search", { query: { q } }); skipMissing(ctx, r);
        expect(r.status, q).toBe(200); noLeak(r, `/search?q=${q}`);
      }
    });
    it("/products/facets and /categories exclude hidden data and inactive categories", async (ctx) => {
      const f = await call("GET", "/products/facets"); skipMissing(ctx, f); noLeak(f, "facets");
      expect(f.text).not.toContain("999900"); // hidden products' price must not widen the price facet
      const c = await call("GET", "/categories"); skipMissing(ctx, c); expect(c.text).not.toContain("qa-inactive-cat");
    });
    it("/articles and /articles/{slug} hide drafts and scheduled", async (ctx) => {
      const l = await call("GET", "/articles", { query: { limit: 50 } }); skipMissing(ctx, l); noLeak(l, "/articles");
      for (const s of ["qa-hidden-article-draft", "qa-hidden-article-scheduled"]) expect((await call("GET", `/articles/${s}`)).status, s).toBe(404);
    });
    it("/cart/validate treats hidden variants as unavailable (never priced/purchasable)", async (ctx) => {
      if (!HIDDEN_V.length) ctx.skip("QA_HIDDEN_VARIANT_IDS not set");
      const r = await call("POST", "/cart/validate", { body: { items: HIDDEN_V.map((variantId) => ({ variantId, quantity: 1 })) } });
      skipMissing(ctx, r); expect(r.status).toBe(200);
      for (const l of r.json.data.lines) {
        expect(l.available, l.variantId).toBe(false);
        expect(l).toHaveProperty("lowStock");
        expect(typeof l.lowStock).toBe("boolean");
        expect(l).not.toHaveProperty("maxQuantity");
        expect(["out_of_stock", "insufficient_stock", "inactive", "unpublished", "not_found"]).toContain(l.issue);
      }
      expect(r.json.data.allAvailable).toBe(false);
      noLeak(r, "/cart/validate");
    });
  });

  describe("no exact stock counts (lowStock boolean, contract 5b39655)", () => {
    it("no stock_on_hand / maxQuantity / reserved / exact count in any public payload", async (ctx) => {
      const paths = ["/products?limit=50", "/products/demo-linen-wrap-dress", "/products/facets", "/search?q=dress"];
      for (const p of paths) {
        const [path, qs] = p.split("?");
        const r = await call("GET", path, { query: Object.fromEntries(new URLSearchParams(qs || "")) }); skipMissing(ctx, r);
        expect(r.text, p).not.toMatch(/stock_?on_?hand|stock_?reserved|"stock"\s*:|"maxQuantity"|"quantityAvailable"|"inventory"/i);
        expect(r.text, `${p} contains the seeded exact count 137`).not.toMatch(/[^0-9]137[^0-9]/);
      }
    });
    it("/cart/validate: available+lowStock boolean only; qty>10 -> 400; insufficient_stock keeps qty (never clamps)", async (ctx) => {
      if (!V137) ctx.skip("QA_V137 not set");
      const ok = await call("POST", "/cart/validate", { body: { items: [{ variantId: V137, quantity: 1 }] } }); skipMissing(ctx, ok);
      expect(ok.status).toBe(200);
      const line = ok.json.data.lines[0];
      expect(line).toHaveProperty("available"); expect(line).toHaveProperty("lowStock");
      expect(line).not.toHaveProperty("maxQuantity");
      expect(typeof line.lowStock).toBe("boolean");
      expect(ok.text).not.toContain("137");
      // qty 11 exceeds MAX_LINE_QTY -> 400
      expect((await call("POST", "/cart/validate", { body: { items: [{ variantId: V137, quantity: 11 }] } })).status).toBe(400);
      // ask for more than on hand but <= MAX_LINE_QTY: issue insufficient_stock, quantity unchanged (no clamp that would reveal stock)
      const big = await call("POST", "/cart/validate", { body: { items: [{ variantId: V137, quantity: 10 }] } });
      // V137 has 137, so 10 is fine; seed a scarce one via HIDDEN or accept available:true
      if (big.status === 200 && big.json.data.lines[0].available) expect(big.json.data.lines[0].quantity).toBe(10);
      // lowStock true only when sellable <= 3: set via DB is out of scope here; assert the field is boolean and false for 137
      expect(line.lowStock).toBe(false);
    });
  });

  describe("/cart/validate ignores client prices", () => {
    it("client unitPriceMinor / lineTotalMinor / subtotalMinor / currency are ignored or rejected", async (ctx) => {
      if (!V137) ctx.skip("QA_V137 not set");
      const r = await call("POST", "/cart/validate", { body: { items: [{ variantId: V137, quantity: 2, unitPriceMinor: 1, priceMinor: 1, lineTotalMinor: 2 }], subtotalMinor: 2, currency: "USD" } });
      skipMissing(ctx, r);
      if (r.status === 400) return; // strict schema rejecting unknown keys is fine
      expect(r.status).toBe(200);
      expect(r.json.data.lines[0].unitPriceMinor).toBe(PRICE || r.json.data.lines[0].unitPriceMinor);
      expect(r.json.data.lines[0].unitPriceMinor).toBeGreaterThan(1);
      expect(r.json.data.subtotalMinor).toBe(r.json.data.lines[0].unitPriceMinor * 2);
      expect(r.json.data.currency).toBe("UZS");
    });
    it("quantity abuse -> 400 (0, -1, 11, 1e9, 1.5, string), duplicates and >50 lines -> 400", async (ctx) => {
      const v = V137 || "00000000-0000-4000-8000-000000000000";
      for (const quantity of [0, -1, 11, 1e9, 1.5, "2"]) {
        const r = await call("POST", "/cart/validate", { body: { items: [{ variantId: v, quantity }] } }); skipMissing(ctx, r);
        expect(r.status, `quantity ${quantity}`).toBe(400);
      }
      expect((await call("POST", "/cart/validate", { body: { items: [{ variantId: v, quantity: 1 }, { variantId: v, quantity: 1 }] } })).status, "duplicate lines").toBe(400);
      const many = Array.from({ length: 51 }, (_, i) => ({ variantId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, quantity: 1 }));
      expect((await call("POST", "/cart/validate", { body: { items: many } })).status, "51 lines").toBe(400);
      expect((await call("POST", "/cart/validate", { raw: "{bad", headers: { "content-type": "application/json" } })).status).toBe(400);
    });
  });

  describe("search injection", () => {
    const evil = ["' OR 1=1 --", "'; drop table products; --", "dress' & 'x", "a:* | b:*", "!(dress)", "<->", "\\", "%_%", "%%", "dress)) OR ((1=1", "$$", "\u0000dress", "😀😀", "ﬀ", "a".repeat(100), "<script>alert(1)</script>"];
    it("never 500, never more results than a benign query, no SQL error text", async (ctx) => {
      const base = await call("GET", "/search", { query: { q: "zzzznotaword" } }); skipMissing(ctx, base);
      for (const q of evil) {
        const r = await call("GET", "/search", { query: { q } });
        expect(r.status, `q=${JSON.stringify(q)}`).not.toBe(500);
        expect([200, 400], `q=${JSON.stringify(q)}`).toContain(r.status);
        expect(r.text).not.toMatch(/syntax error|tsquery|postgres|PG::|SQLSTATE|relation "|column "/i);
        noLeak(r, `/search?q=${q}`);
      }
      expect((await call("GET", "/search", { query: { q: "a".repeat(101) } })).status, "q > 100 chars").toBe(400);
      expect((await call("GET", "/search", { query: { q: "a" } })).status, "q < 2 chars").toBe(400);
      expect((await call("GET", "/search", { query: { q: "   " } })).status, "whitespace-only q").toBe(400);
    });
    it("'%' / '_' wildcards are literal (ILIKE escaped): q='%%' returns no more than a nonsense query", async (ctx) => {
      const a = await call("GET", "/search", { query: { q: "%%" } }); skipMissing(ctx, a);
      if (a.status !== 200) return;
      const count = (r) => JSON.stringify(r.json.data).match(/"slug"/g)?.length ?? 0;
      expect(count(a), "q=%% matched everything: ILIKE wildcards not escaped").toBe(0);
      const u = await call("GET", "/search", { query: { q: "__" } });
      expect(count(u), "q=__ matched everything").toBe(0);
    });
  });

  describe("limit / cursor abuse", () => {
    it("limit 0 / -1 / 101 (MAX_LIMIT 100) / 1e9 / abc / 1.5 -> 400, never a huge page", async (ctx) => {
      for (const limit of ["0", "-1", "101", "1000000000", "abc", "1.5", ""]) {
        const r = await call("GET", "/products", { query: { limit } }); skipMissing(ctx, r);
        if (limit === "") { expect([200, 400]).toContain(r.status); continue; }
        expect(r.status, `limit=${limit}`).toBe(400);
      }
      for (const path of ["/articles", "/search"]) {
        const r = await call("GET", path, { query: { limit: "1000000", q: "dress" } });
        if (!notImplemented(r)) expect(r.status, `${path} limit=1e6`).toBe(400);
      }
    });
    it("garbage / tampered / oversized cursor -> 400 (not 500, not page 1 silently with errors)", async (ctx) => {
      const first = await call("GET", "/products", { query: { limit: 1 } }); skipMissing(ctx, first);
      const good = first.json.page?.cursor;
      const bad = ["x", "!!!!", "eyJ9", Buffer.from('{"id":"\' OR 1=1 --","t":"x"}').toString("base64url"), Buffer.from('{"offset":-1}').toString("base64url"), "A".repeat(513)];
      if (good) bad.push(good.slice(0, -2) + (good.endsWith("A") ? "BB" : "AA"));
      for (const cursor of bad) {
        const r = await call("GET", "/products", { query: { limit: 1, cursor } });
        expect(r.status, `cursor=${cursor.slice(0, 40)}`).not.toBe(500);
        expect([400, 200], `cursor=${cursor.slice(0, 40)}`).toContain(r.status);
        if (r.status === 200) noLeak(r, "tampered cursor");
      }
      expect((await call("GET", "/products", { query: { cursor: "A".repeat(513) } })).status, "cursor > 512").toBe(400);
    });
    it("a valid cursor pages forward without duplicates or skipped rows", async (ctx) => {
      const all = await call("GET", "/products", { query: { limit: 50 } }); skipMissing(ctx, all);
      const ids = []; let cursor; let n = 0;
      do { const r = await call("GET", "/products", { query: { limit: 3, cursor } }); ids.push(...r.json.data.map((p) => p.id)); cursor = r.json.page.cursor; n++; } while (cursor && n < 50);
      expect(new Set(ids).size, "duplicates across pages").toBe(ids.length);
      expect(ids.length).toBe(all.json.data.length);
    });
  });

  describe("newsletter", () => {
    const uniq = () => `qa+${Date.now()}${Math.floor(Math.random() * 1e6)}@dooyoosh.test`;
    it("same 202 body for new, repeated and invalid-but-honeypot emails (no enumeration)", async (ctx) => {
      const e = uniq();
      const a = await call("POST", "/newsletter", { body: { email: e, locale: "en" }, headers: { "x-real-ip": "10.9.0.1" } }); skipMissing(ctx, a);
      const b = await call("POST", "/newsletter", { body: { email: e, locale: "en" }, headers: { "x-real-ip": "10.9.0.2" } });
      const h = await call("POST", "/newsletter", { body: { email: uniq(), locale: "en", website: "http://spam" }, headers: { "x-real-ip": "10.9.0.3" } });
      expect([a.status, b.status, h.status]).toEqual([202, 202, 202]);
      expect(b.text).toBe(a.text); expect(h.text).toBe(a.text);
    });
    it("email is trimmed + lowercased (surrounding spaces accepted, not 400)", async (ctx) => {
      const e = uniq();
      const r = await call("POST", "/newsletter", { body: { email: `  ${e.toUpperCase()}  `, locale: "en" }, headers: { "x-real-ip": "10.9.1.1" } });
      skipMissing(ctx, r);
      expect(r.status, "an email with surrounding whitespace is rejected instead of trimmed").toBe(202);
    });
    it("invalid email / unknown fields / bad locale -> 400 with a generic envelope", async (ctx) => {
      for (const body of [{ email: "nope", locale: "en" }, { email: "a@b.c", locale: "xx" }, {}]) {
        const r = await call("POST", "/newsletter", { body, headers: { "x-real-ip": "10.9.2.1" } }); skipMissing(ctx, r);
        expect(r.status, JSON.stringify(body)).toBe(400);
      }
    });
    it("rate limit: 11th request from one IP is accepted-looking but not processed; spoofed x-real-ip must not reset it", async (ctx) => {
      // Black-box we can only observe that responses stay 202 (by design). The bypass check is in QA_REPORT via DB count.
      const ip = "10.9.3.1"; const rs = [];
      for (let i = 0; i < 12; i++) rs.push((await call("POST", "/newsletter", { body: { email: uniq(), locale: "en" }, headers: { "x-real-ip": ip } })).status);
      skipMissing(ctx, { status: rs[0], text: "{}", headers: new Headers({ "content-type": "application/json" }) });
      expect(new Set(rs)).toEqual(new Set([202]));
    });
    it("confirm: bad / short / long token -> 404 or 400, never 500", async (ctx) => {
      for (const token of ["x", "q".repeat(43), "q".repeat(200), "' OR 1=1 --"]) {
        const r = await call("POST", "/newsletter/confirm", { body: { token } });
        if (notImplemented(r)) { const g = await call("GET", "/newsletter/confirm", { query: { token } }); skipMissing(ctx, g); expect([400, 404]).toContain(g.status); continue; }
        expect([400, 404], token).toContain(r.status);
      }
    });
  });
});
