import { afterEach, describe, expect, it, vi } from "vitest";
import { mockProviderAllowed, sandboxSimulatorEnabled } from "./sandbox-gate";
import { loadPaymentConfig } from "./config";

const TOK = "t".repeat(40);
const base = { ORDER_TOKEN_SECRET: TOK, PAYMENT_WEBHOOK_SECRET: "whsec_x" };

describe("sandbox gate (pure)", () => {
  it.each([
    [{ PAYMENT_MODE: "sandbox", SANDBOX_SIMULATOR_ENABLED: "true", PAYMENT_PROVIDER: "mock" }, true],
    [{ PAYMENT_MODE: "sandbox", SANDBOX_SIMULATOR_ENABLED: "true", PAYMENT_PROVIDER: "click" }, true],
    [{ PAYMENT_MODE: "sandbox", SANDBOX_SIMULATOR_ENABLED: "true", PAYMENT_PROVIDER: "payme" }, false],
    [{ PAYMENT_MODE: "sandbox", SANDBOX_SIMULATOR_ENABLED: "1", PAYMENT_PROVIDER: "mock" }, false],
    [{ PAYMENT_MODE: "sandbox", PAYMENT_PROVIDER: "mock" }, false],
    [{ SANDBOX_SIMULATOR_ENABLED: "true", PAYMENT_PROVIDER: "mock" }, false],
    [{ PAYMENT_MODE: "live", SANDBOX_SIMULATOR_ENABLED: "true", PAYMENT_PROVIDER: "click" }, false],
    [{ PAYMENT_MODE: "Sandbox", SANDBOX_SIMULATOR_ENABLED: "true", PAYMENT_PROVIDER: "mock" }, false],
  ])("simulator %o -> %s", (env, want) => expect(sandboxSimulatorEnabled(env)).toBe(want));

  it("mock provider: never in live; in NODE_ENV=production only with sandbox + ALLOW_MOCK_IN_PRODUCTION", () => {
    expect(mockProviderAllowed({ PAYMENT_MODE: "live", ALLOW_MOCK_IN_PRODUCTION: "true" })).toBe(false);
    expect(mockProviderAllowed({ NODE_ENV: "production", PAYMENT_MODE: "sandbox" })).toBe(false);
    expect(mockProviderAllowed({ NODE_ENV: "production", ALLOW_MOCK_IN_PRODUCTION: "true" })).toBe(false);
    expect(mockProviderAllowed({ NODE_ENV: "production", PAYMENT_MODE: "sandbox", SANDBOX_SIMULATOR_ENABLED: "true" })).toBe(false);
    expect(mockProviderAllowed({ NODE_ENV: "production", PAYMENT_MODE: "sandbox", ALLOW_MOCK_IN_PRODUCTION: "true" })).toBe(true);
    expect(mockProviderAllowed({ NODE_ENV: "development" })).toBe(true);
  });

  it("config follows the gate (deployed Vercel sandbox = NODE_ENV=production)", () => {
    expect(() => loadPaymentConfig({ ...base, NODE_ENV: "production", PAYMENT_PROVIDER: "mock", PAYMENT_MODE: "sandbox" })).toThrow(/mock/);
    expect(loadPaymentConfig({ ...base, NODE_ENV: "production", PAYMENT_PROVIDER: "mock", PAYMENT_MODE: "sandbox", ALLOW_MOCK_IN_PRODUCTION: "true" }).provider).toBe("mock");
    expect(() => loadPaymentConfig({ ...base, PAYMENT_PROVIDER: "mock", PAYMENT_MODE: "live", NEXT_PUBLIC_SITE_URL: "https://x.uz" })).toThrow(/mock/);
  });
});

describe("routes return 404 before parsing / DB when the gate is closed", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  const container = async () => {
    const m = await import("./container");
    return vi.spyOn(m, "getPayments");
  };

  it.each([
    { PAYMENT_MODE: "live", SANDBOX_SIMULATOR_ENABLED: "true", PAYMENT_PROVIDER: "click" },
    { PAYMENT_MODE: "sandbox", SANDBOX_SIMULATOR_ENABLED: "", PAYMENT_PROVIDER: "mock" },
    { PAYMENT_MODE: "sandbox", SANDBOX_SIMULATOR_ENABLED: "true", PAYMENT_PROVIDER: "payme" },
  ])("sandbox-pay %o -> 404", async (env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const spy = await container();
    const { POST } = await import("@/app/api/v1/checkout/[checkoutId]/sandbox-pay/route");
    // invalid checkoutId + no token: if anything parsed first we would get 400, not 404
    const res = await POST(new Request("http://x/api/v1/checkout/not-a-uuid/sandbox-pay"), { params: Promise.resolve({ checkoutId: "not-a-uuid" }) });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
    expect(spy).not.toHaveBeenCalled();
  });

  it("/webhooks/mock -> 404 in live mode, without reading the body", async () => {
    vi.stubEnv("PAYMENT_MODE", "live");
    vi.stubEnv("PAYMENT_PROVIDER", "payme");
    const spy = await container();
    const { POST } = await import("@/app/api/v1/webhooks/[provider]/route");
    const req = new Request("http://x/api/v1/webhooks/mock", { method: "POST", body: "{not json" });
    const res = await POST(req, { params: Promise.resolve({ provider: "mock" }) });
    expect(res.status).toBe(404);
    expect(req.bodyUsed).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("/webhooks/mock -> 404 under NODE_ENV=production without ALLOW_MOCK_IN_PRODUCTION", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENT_MODE", "sandbox");
    const { POST } = await import("@/app/api/v1/webhooks/[provider]/route");
    const res = await POST(new Request("http://x", { method: "POST", body: "{}" }), { params: Promise.resolve({ provider: "mock" }) });
    expect(res.status).toBe(404);
  });
});

describe("fail-fast config (QA)", () => {
  it.each(["payme", "click", "mock"])("PAYMENT_MODE=live + ALLOW_MOCK_IN_PRODUCTION=true refused (provider %s)", (p) => {
    expect(() => loadPaymentConfig({ ...base, PAYMENT_PROVIDER: p, PAYMENT_MODE: "live", ALLOW_MOCK_IN_PRODUCTION: "true", NEXT_PUBLIC_SITE_URL: "https://x.uz", PAYME_MERCHANT_ID: "m", PAYME_KEY: "k", CLICK_SERVICE_ID: "1", CLICK_MERCHANT_ID: "2", CLICK_SECRET_KEY: "s" })).toThrow(/ALLOW_MOCK_IN_PRODUCTION/);
  });
});
