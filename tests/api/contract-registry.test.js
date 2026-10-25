// Static checks on src/contracts (run without a server). Guards the matrix the live tests rely on.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { endpoints } from "../../src/contracts/index.ts";
import { ROLE_MATRIX } from "../../src/contracts/admin.ts";

const E = Object.entries(endpoints);
const area = (name, p) => {
  if (/\/adjust$|\/movements$/.test(p)) return "inventory";
  if (/\/shipments$/.test(p)) return "shipments";
  const seg = p.split("/")[2];
  return { products: "products", variants: "products", orders: "orders", articles: "articles", media: "media" }[seg];
};

describe("contract registry", () => {
  it("registry and docs/CONTRACTS.md list the same endpoints", () => {
    const doc = fs.readFileSync(path.resolve(import.meta.dirname, "../../docs/CONTRACTS.md"), "utf8");
    const rows = [...doc.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]);
    expect(rows.sort()).toEqual(E.map(([n]) => n).sort());
  });
  it("every route handler under src/app/api/v1 is in the registry (no off-contract endpoints)", () => {
    const base = path.resolve(import.meta.dirname, "../../src/app/api/v1");
    if (!fs.existsSync(base)) return;
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name === "route.ts" ? [path.join(d, e.name)] : []));
    const toPath = (f) => "/" + path.relative(base, path.dirname(f)).split(path.sep).map((s) => s.replace(/^\[(\w+)\]$/, "{$1}")).join("/");
    const known = new Set(E.map(([, d]) => d.path.replace(/\{\w+\}/g, "{}")));
    // Known, reported off-contract routes (remove once added to src/contracts/index.ts):
    const KNOWN = { "/checkout/{checkoutId}/sandbox-pay": "QA-22" };
    const extra = walk(base).map(toPath).filter((p) => !known.has(p.replace(/\{\w+\}/g, "{}")) && !KNOWN[p]);
    expect(extra, "routes not in src/contracts/index.ts").toEqual([]);
  });
  it("method+path pairs are unique", () => {
    const keys = E.map(([, d]) => `${d.method} ${d.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("every /admin/* endpoint is auth=admin with roles = ROLE_MATRIX for its area", () => {
    for (const [n, d] of E.filter(([, d]) => d.path.startsWith("/admin/"))) {
      expect(d.auth, n).toBe("admin");
      const a = area(n, d.path);
      const want = Object.entries(ROLE_MATRIX).filter(([, areas]) => areas.includes(a)).map(([r]) => r).sort();
      expect([...d.roles].sort(), `${n} (${a})`).toEqual(want);
    }
  });
  it("no non-admin path is auth=admin; webhooks/cron use their own auth", () => {
    for (const [n, d] of E.filter(([, d]) => !d.path.startsWith("/admin/"))) {
      const want = d.path.startsWith("/webhooks/") ? "webhook" : d.path.startsWith("/cron/") ? "cron" : "public";
      expect(d.auth, n).toBe(want);
    }
  });
  // QA-21 (Architect): known doc defect. it.fails passes while the defect exists; when the spec is fixed, change to it().
  it.fails("ARCHITECTURE.md §4/§5 webhook path agrees with the registry (/webhooks/{provider})", () => {
    const spec = fs.readFileSync(path.resolve(import.meta.dirname, "../../docs/ARCHITECTURE.md"), "utf8");
    expect(endpoints.paymentWebhook.path).toBe("/webhooks/{provider}");
    expect(spec, "spec still documents /payments/{provider}/callback").not.toMatch(/\/payments\/\{provider\}\/callback/);
  });
});
