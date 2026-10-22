// Build artefact scan: no server secrets in anything shipped to the browser.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const STATIC = process.env.QA_NEXT_DIR ? path.join(process.env.QA_NEXT_DIR, "static") : path.join(ROOT, ".next/static");
const built = fs.existsSync(STATIC);
const files = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : [path.join(d, e.name)]));
const PATTERNS = [
  [/SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE/, "service role key name"],
  [/"role"\s*:\s*"service_role"|c2VydmljZV9yb2xl/, "service_role JWT (raw or base64 payload)"],
  [/\bsk_(live|test)_[0-9A-Za-z]{10,}/, "Stripe secret key"],
  [/\bwhsec_[0-9A-Za-z]{10,}/, "Stripe webhook secret"],
  [/\bre_[0-9A-Za-z]{8,}_[0-9A-Za-z]{8,}/, "Resend API key"],
  [/PAYME_KEY|CLICK_SECRET_KEY|PAYMENT_WEBHOOK_SECRET|CRON_SECRET|DATABASE_URL|TOKEN_SECRET/, "server env var name"],
  [/postgres(ql)?:\/\/[^"'\s]+:[^"'\s]+@/, "DB connection string with password"],
];

describe.skipIf(!built)(`client bundle secret scan${built ? "" : " [SKIPPED: no .next/static, run `pnpm build` first]"}`, () => {
  it("no server secrets or their env names in .next/static", () => {
    const hits = [];
    for (const f of files(STATIC).filter((x) => /\.(js|css|html|json|map|txt)$/.test(x))) {
      const s = fs.readFileSync(f, "utf8");
      for (const [re, what] of PATTERNS) if (re.test(s)) hits.push(`${path.relative(ROOT, f)}: ${what}`);
    }
    // also any literal value of a secret present in the test env
    const secretVals = ["SUPABASE_SERVICE_ROLE_KEY", "PAYME_KEY", "CLICK_SECRET_KEY", "PAYMENT_WEBHOOK_SECRET", "CRON_SECRET", "RESEND_API_KEY", "TOKEN_SECRET"]
      .map((k) => process.env[k]).filter((v) => v && v.length >= 12);
    for (const f of files(STATIC)) { const s = fs.readFileSync(f, "utf8"); for (const v of secretVals) if (s.includes(v)) hits.push(`${path.relative(ROOT, f)}: literal secret value`); }
    expect(hits).toEqual([]);
  });
  it("only NEXT_PUBLIC_* env names are referenced from client code", () => {
    const bad = new Set();
    for (const f of files(STATIC).filter((x) => x.endsWith(".js"))) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z0-9_]+)/g)) if (!m[1].startsWith("NEXT_PUBLIC_") && m[1] !== "NODE_ENV") bad.add(m[1]);
    }
    expect([...bad]).toEqual([]);
  });
});
