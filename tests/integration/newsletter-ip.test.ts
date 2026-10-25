/** 0008 app side: client IP only from TRUSTED_IP_HEADER; IP/email hashed (HMAC with NEWSLETTER_HASH_SECRET). */
import { describe, it, expect } from "vitest";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const F = path.resolve(__dirname, "../../src/server/journal/rate-limit.ts");
const HAS = fs.existsSync(F) && fs.readFileSync(F, "utf8").includes("TRUSTED_IP_HEADER");
const H = (o: Record<string, string>) => new Headers(o);

describe.skipIf(!HAS)("newsletter client IP + hashing (0008)", () => {
  const load = async () => (await import("@/server/journal/rate-limit")) as any;
  it("default header x-vercel-forwarded-for; spoofed x-real-ip / x-forwarded-for ignored off-Vercel", async () => {
    const { clientIp } = await load();
    expect(clientIp(H({ "x-real-ip": "6.6.6.6", "x-forwarded-for": "7.7.7.7" }), {})).toBeNull();
    expect(clientIp(H({ "x-vercel-forwarded-for": "203.0.113.9, 10.0.0.1", "x-real-ip": "6.6.6.6", "x-forwarded-for": "7.7.7.7" }), {})).toBe("203.0.113.9");
  });
  it("custom TRUSTED_IP_HEADER is the only source; others ignored", async () => {
    const { clientIp } = await load();
    const env = { TRUSTED_IP_HEADER: "CF-Connecting-IP" };
    expect(clientIp(H({ "cf-connecting-ip": "198.51.100.4", "x-vercel-forwarded-for": "6.6.6.6" }), env)).toBe("198.51.100.4");
    expect(clientIp(H({ "x-vercel-forwarded-for": "6.6.6.6", "x-real-ip": "6.6.6.7" }), env)).toBeNull();
  });
  it("x-real-ip fallback only when VERCEL=1", async () => {
    const { clientIp } = await load();
    expect(clientIp(H({ "x-real-ip": "203.0.113.1" }), { VERCEL: "1" })).toBe("203.0.113.1");
    expect(clientIp(H({ "x-real-ip": "203.0.113.1" }), { VERCEL: "0" })).toBeNull();
  });
  it("oversized header value is truncated (no unbounded key)", async () => {
    const { clientIp } = await load();
    expect(clientIp(H({ "x-vercel-forwarded-for": "1".repeat(5000) }), {})!.length).toBeLessThanOrEqual(64);
  });
  it("hashKey = HMAC(NEWSLETTER_HASH_SECRET) when set: not plain sha256 of the IP, 64 lower-hex, kind-separated", async () => {
    const { hashKey } = await load();
    const env = { NEWSLETTER_HASH_SECRET: "qa_secret_0123456789abcdef0123456789" };
    const v = hashKey("ip", "203.0.113.9", env);
    expect(v).toMatch(/^[0-9a-f]{64}$/);
    expect(v).not.toBe(createHash("sha256").update("203.0.113.9").digest("hex"));
    expect(v).toBe(createHmac("sha256", env.NEWSLETTER_HASH_SECRET).update("dooyoosh:newsletter:ip:203.0.113.9").digest("hex"));
    expect(hashKey("email", "203.0.113.9", env)).not.toBe(v);
  });
  it("production requires NEWSLETTER_HASH_SECRET (>=32 chars)", async () => {
    const { parseServerEnv } = await import("@/lib/env") as any;
    const base = {
      NODE_ENV: "production", DATABASE_URL: "postgres://u:p@localhost:5432/db", SUPABASE_SERVICE_ROLE_KEY: "x",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "x", NEXT_PUBLIC_SITE_URL: "https://shop.example",
      EMAIL_FROM: "a@b.c", RESEND_API_KEY: "x", CRON_SECRET: "c".repeat(32), ORDER_TOKEN_SECRET: "o".repeat(40),
      PAYMENT_WEBHOOK_SECRET: "w".repeat(32), PAYMENTS_STORE: "postgres", PAYMENT_PROVIDER: "payme", PAYMENT_MODE: "sandbox",
      NEXT_PUBLIC_PAYMENT_MODE: "sandbox", DEFAULT_CURRENCY: "UZS", PAYME_MERCHANT_ID: "m", PAYME_KEY: "k".repeat(20),
      CLICK_SERVICE_ID: "1", CLICK_MERCHANT_ID: "2", CLICK_SECRET_KEY: "s".repeat(10), NEWSLETTER_HASH_SECRET: "n".repeat(32),
    };
    const { NEWSLETTER_HASH_SECRET: _n, ...noHash } = base as any;
    expect(() => parseServerEnv(noHash)).toThrow(/NEWSLETTER_HASH_SECRET/);
    expect(() => parseServerEnv({ ...base, NEWSLETTER_HASH_SECRET: "short" })).toThrow();
    expect(() => parseServerEnv({ ...base, NEWSLETTER_HASH_SECRET: "n".repeat(32) })).not.toThrow();
  });
});
