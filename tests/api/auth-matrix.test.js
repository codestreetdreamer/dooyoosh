// Live: every endpoint's auth rule. Skips the whole file if the server is down; skips one endpoint if its route is not built yet.
import { describe, it, expect } from "vitest";
import { endpoints } from "../../src/contracts/index.ts";
import { ADMIN_ROLES } from "../../src/contracts/admin.ts";
import { UP, DOWN_REASON, call, fillPath, skipIfMissing, expectEnvelope, roleHeaders } from "./lib/http.js";

const E = Object.entries(endpoints);
const body = (d) => (d.method === "GET" ? undefined : {});

describe.skipIf(!UP)(`auth matrix${UP ? "" : ` [SKIPPED: ${DOWN_REASON}]`}`, () => {
  for (const [name, d] of E.filter(([, d]) => d.auth === "admin")) {
    describe(`${name} ${d.method} ${d.path} [${d.roles.join(",")}]`, () => {
      it("no session -> 401 UNAUTHORIZED (before body validation, so no 400 schema leak)", async (ctx) => {
        const r = await call(d.method, fillPath(d.path), { body: body(d) });
        skipIfMissing(ctx, r, name);
        expectEnvelope(expect, r, 401, "UNAUTHORIZED");
      });
      it("forged session cookie / bearer -> 401", async (ctx) => {
        const r1 = await call(d.method, fillPath(d.path), { body: body(d), headers: { cookie: "sb-access-token=forged; sb-refresh-token=forged" } });
        skipIfMissing(ctx, r1, name);
        expectEnvelope(expect, r1, 401, "UNAUTHORIZED");
        const r2 = await call(d.method, fillPath(d.path), { body: body(d), headers: { authorization: "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSJ9." } });
        expectEnvelope(expect, r2, 401, "UNAUTHORIZED");
      });
      for (const role of ADMIN_ROLES) {
        const allowed = d.roles.includes(role);
        it(`${role} -> ${allowed ? "allowed (not 401/403)" : "403 FORBIDDEN"}`, async (ctx) => {
          const h = roleHeaders(role);
          if (!h) ctx.skip(`set QA_ADMIN_COOKIE_${role.toUpperCase()} or QA_ADMIN_BEARER_${role.toUpperCase()}`);
          const r = await call(d.method, fillPath(d.path), { body: body(d), headers: h });
          skipIfMissing(ctx, r, name);
          if (allowed) expect([401, 403], r.text.slice(0, 200)).not.toContain(r.status);
          else expectEnvelope(expect, r, 403, "FORBIDDEN");
        });
      }
    });
  }

  for (const [name, d] of E.filter(([, d]) => d.auth === "public")) {
    it(`${name} ${d.method} ${d.path}: public, never 401/403, errors use the envelope`, async (ctx) => {
      const r = await call(d.method, fillPath(d.path), { body: body(d) });
      skipIfMissing(ctx, r, name);
      expect([401, 403]).not.toContain(r.status);
      if (r.status >= 400) expect(r.json?.error?.code, r.text.slice(0, 200)).toBeTruthy();
      expect(r.status, "never 500 on bad/empty input").toBeLessThan(500);
    });
  }

  it("cronReleaseExpired: no Authorization -> 401", async (ctx) => {
    const r = await call("POST", "/cron/release-expired");
    skipIfMissing(ctx, r, "cron");
    expectEnvelope(expect, r, 401, "UNAUTHORIZED");
  });
  it("cronReleaseExpired: wrong bearer -> 401; also GET is not an unauthenticated trigger", async (ctx) => {
    const r = await call("POST", "/cron/release-expired", { headers: { authorization: "Bearer wrong-secret-0000000000" } });
    skipIfMissing(ctx, r, "cron");
    expectEnvelope(expect, r, 401, "UNAUTHORIZED");
    const g = await call("GET", "/cron/release-expired");
    expect([401, 405]).toContain(g.status);
  });
  it("cronReleaseExpired: correct CRON_SECRET -> 200 {checkoutsExpired, reservationsReleased}", async (ctx) => {
    if (!process.env.CRON_SECRET) ctx.skip("set CRON_SECRET");
    const r = await call("POST", "/cron/release-expired", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    skipIfMissing(ctx, r, "cron");
    expect(r.status).toBe(200);
    endpoints.cronReleaseExpired.response.parse(r.json);
  });
  it("unknown webhook provider -> 400/404 envelope, not 500", async (ctx) => {
    const r = await call("POST", "/webhooks/paypal", { raw: "{}" });
    skipIfMissing(ctx, r, "webhooks");
    expect([400, 404]).toContain(r.status);
  });
});
