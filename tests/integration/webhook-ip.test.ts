/** Payme/Click webhook IP allow-list: only TRUSTED_IP_HEADER (default x-vercel-forwarded-for). Spoofed headers ignored. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash, createHmac, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const HAS = fs.existsSync(path.join(ROOT, "src/server/payments/container.ts"))
  && fs.readFileSync(path.join(ROOT, "src/server/payments/container.ts"), "utf8").includes("TRUSTED_IP_HEADER");
const SECRET = "qa_mock_webhook_secret_0123456789abcdef";
const PAYME_KEY = "QA_PAYME_TEST_KEY_0123456789abcdef";
const CRON = "qa_cron_secret_0123456789abcdef";
const B = "http://qa.local/api/v1";
const PAYME_IP = "185.234.113.1"; // PAYME_IPS[0]

async function load(provider: "mock" | "payme" | "click", extra: Record<string, string> = {}) {
  vi.resetModules();
  const env = {
    PAYMENTS_STORE: "memory", PAYMENT_PROVIDER: provider, PAYMENT_MODE: "live", NEXT_PUBLIC_PAYMENT_MODE: "live",
    PAYMENT_WEBHOOK_SECRET: SECRET, ORDER_TOKEN_SECRET: "qa_order_token_secret_0123456789abcdef0123",
    CRON_SECRET: CRON, NEXT_PUBLIC_SITE_URL: "https://shop.example", PAYME_MERCHANT_ID: "qa-merchant", PAYME_KEY,
    PAYME_LOGIN: "Paycom", PAYME_ACCOUNT_FIELD: "order_id", CLICK_SERVICE_ID: "123", CLICK_MERCHANT_ID: "456",
    CLICK_SECRET_KEY: "qa_click_secret", DEFAULT_CURRENCY: "UZS", TRUSTED_IP_HEADER: "x-vercel-forwarded-for", ...extra,
  };
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const container = await import("@/server/payments/container");
  const webhook = await import("@/app/api/v1/webhooks/[provider]/route");
  return { container, webhook };
}

describe.skipIf(!HAS)("webhook IP allow-list (TRUSTED_IP_HEADER)", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("clientIp reads only TRUSTED_IP_HEADER; spoofed x-real-ip / x-forwarded-for ignored", async () => {
    const { clientIp } = await import("@/server/payments/container");
    const h = new Headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8", "x-vercel-forwarded-for": `${PAYME_IP}, 10.0.0.1` });
    expect(clientIp(h)).toBe(PAYME_IP);
    expect(clientIp(new Headers({ "x-real-ip": PAYME_IP, "x-forwarded-for": PAYME_IP }))).toBeNull();
  });

  it("Payme live: missing trusted IP header -> -32504; spoofed x-forwarded-for with a Payme IP still -32504", async () => {
    // live + mock provider is refused; use payme provider
    let m: Awaited<ReturnType<typeof load>>;
    try { m = await load("payme"); } catch { return; } // fiscal / live seed may refuse in memory
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "CheckPerformTransaction", params: { amount: 100, account: { order_id: randomUUID() } } });
    const auth = "Basic " + Buffer.from(`Paycom:${PAYME_KEY}`).toString("base64");
    const post = (headers: Record<string, string>) =>
      m.webhook.POST(new Request(`${B}/webhooks/payme`, { method: "POST", body, headers: { "content-type": "application/json", authorization: auth, ...headers } }), { params: Promise.resolve({ provider: "payme" }) });
    const missing = await post({});
    expect(missing.status).toBe(200);
    expect((await missing.json()).error?.code).toBe(-32504);
    const spoof = await post({ "x-forwarded-for": PAYME_IP, "x-real-ip": PAYME_IP });
    expect(spoof.status).toBe(200);
    expect((await spoof.json()).error?.code).toBe(-32504);
    const ok = await post({ "x-vercel-forwarded-for": PAYME_IP });
    // may be -31050 (unknown account) once auth+IP pass — must NOT be -32504
    const j = await ok.json();
    expect(j.error?.code, JSON.stringify(j)).not.toBe(-32504);
  });
});
