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
  it("has 37 endpoints", () => expect(E.length).toBe(37));
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
  it("ARCHITECTURE.md §4/§5 webhook path agrees with the registry (/webhooks/{provider})", () => {
    const spec = fs.readFileSync(path.resolve(import.meta.dirname, "../../docs/ARCHITECTURE.md"), "utf8");
    expect(endpoints.paymentWebhook.path).toBe("/webhooks/{provider}");
    expect(spec, "spec still documents /payments/{provider}/callback").not.toMatch(/\/payments\/\{provider\}\/callback/);
  });
});
