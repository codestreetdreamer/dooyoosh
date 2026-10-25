/** Provider IP allow-list source (QA): only env TRUSTED_IP_HEADER (default x-vercel-forwarded-for); XFF / X-Real-IP ignored. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp } from "./container";

const PAYME_IP = "185.234.113.1";

describe("clientIp", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("reads the default x-vercel-forwarded-for, first entry, trimmed", () => {
    expect(clientIp(new Headers({ "x-vercel-forwarded-for": `  ${PAYME_IP} , 10.0.0.1` }))).toBe(PAYME_IP);
  });
  it("ignores spoofable x-forwarded-for and x-real-ip entirely", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": PAYME_IP, "x-real-ip": PAYME_IP }))).toBeNull();
    expect(clientIp(new Headers({ "x-forwarded-for": PAYME_IP, "x-vercel-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });
  it("follows TRUSTED_IP_HEADER; then the default header is no longer trusted", () => {
    vi.stubEnv("TRUSTED_IP_HEADER", "cf-connecting-ip");
    expect(clientIp(new Headers({ "cf-connecting-ip": PAYME_IP }))).toBe(PAYME_IP);
    expect(clientIp(new Headers({ "x-vercel-forwarded-for": PAYME_IP }))).toBeNull();
  });
  it("missing / empty header -> null", () => {
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(new Headers({ "x-vercel-forwarded-for": " , 1.2.3.4" }))).toBeNull();
  });
});

describe("Payme webhook route with the allow-list enabled (live)", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); delete (globalThis as { __dyMemoryStore?: unknown }).__dyMemoryStore; });
  const KEY = "LIVE_TEST_KEY_abcdefghijklmnopqrstuvwxyz";
  async function call(headers: Record<string, string>) {
    for (const [k, v] of Object.entries({ NODE_ENV: "test", PAYMENT_MODE: "live", PAYMENT_PROVIDER: "payme", PAYMENTS_STORE: "memory", ORDER_TOKEN_SECRET: "o".repeat(40), NEXT_PUBLIC_SITE_URL: "https://shop.example", PAYME_MERCHANT_ID: "587f72c72cac0d162c722ae2", PAYME_KEY: KEY, PAYME_LOGIN: "Paycom" })) vi.stubEnv(k, v);
    const { POST } = await import("@/app/api/v1/webhooks/[provider]/route");
    const body = JSON.stringify({ method: "CheckTransaction", params: { id: "5305e3bab097f420a62ced0b" }, id: 1 });
    const res = await POST(new Request("https://shop.example/api/v1/webhooks/payme", { method: "POST", body, headers: { authorization: `Basic ${Buffer.from(`Paycom:${KEY}`).toString("base64")}`, ...headers } }), { params: Promise.resolve({ provider: "payme" }) });
    return (await res.json()) as { error?: { code: number } };
  }
  it("spoofed x-forwarded-for with a Payme IP -> -32504 (not allowed)", async () => {
    expect((await call({ "x-forwarded-for": PAYME_IP, "x-real-ip": PAYME_IP })).error?.code).toBe(-32504);
  });
  it("no trusted header -> -32504", async () => {
    expect((await call({})).error?.code).toBe(-32504);
  });
  it("trusted header with a Payme IP passes the allow-list (reaches txn lookup: -31003)", async () => {
    expect((await call({ "x-vercel-forwarded-for": PAYME_IP, "x-forwarded-for": "6.6.6.6" })).error?.code).toBe(-31003);
  });
});
