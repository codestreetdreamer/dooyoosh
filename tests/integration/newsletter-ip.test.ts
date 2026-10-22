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
  it("production requires NEWSLETTER_HASH_SECRET (unkeyed sha256 of an IPv4 is brute-forceable in seconds)", async () => {
    const envSrc = fs.readFileSync(path.resolve(__dirname, "../../src/lib/env.ts"), "utf8");
    expect(envSrc, "NEWSLETTER_HASH_SECRET not validated in env.ts").toMatch(/NEWSLETTER_HASH_SECRET/);
  });
});
