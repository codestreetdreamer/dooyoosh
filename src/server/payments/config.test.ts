import { describe, expect, it } from "vitest";
import { loadPaymentConfig, resolveMode, PaymentConfigError } from "./config";

const base = { ORDER_TOKEN_SECRET: "x".repeat(32), NEXT_PUBLIC_SITE_URL: "https://shop.example" };

describe("payment config gating", () => {
  it("defaults to sandbox; only exact 'live' enables live", () => {
    expect(resolveMode(undefined)).toBe("sandbox");
    expect(resolveMode("")).toBe("sandbox");
    expect(resolveMode("live")).toBe("live");
    for (const bad of ["LIVE", "production", "live ", "true"]) expect(() => resolveMode(bad)).toThrow(PaymentConfigError);
  });
  it("mock refused in live mode and in production", () => {
    expect(() => loadPaymentConfig({ ...base, PAYMENT_PROVIDER: "mock", PAYMENT_MODE: "live", PAYMENT_WEBHOOK_SECRET: "s" })).toThrow(/not allowed/);
    expect(() => loadPaymentConfig({ ...base, PAYMENT_PROVIDER: "mock", NODE_ENV: "production", PAYMENT_WEBHOOK_SECRET: "s" })).toThrow(/not allowed/);
  });
  it("stripe refused (UZ entity)", () => {
    expect(() => loadPaymentConfig({ ...base, PAYMENT_PROVIDER: "stripe" })).toThrow(/Uzbekistan/);
  });
  it("requires provider credentials from env, never defaults", () => {
    expect(() => loadPaymentConfig({ ...base, PAYMENT_PROVIDER: "payme" })).toThrow(/PAYME_MERCHANT_ID/);
    expect(() => loadPaymentConfig({ ...base, PAYMENT_PROVIDER: "click", CLICK_SERVICE_ID: "1", CLICK_MERCHANT_ID: "2" })).toThrow(/CLICK_SECRET_KEY/);
    const c = loadPaymentConfig({ ...base, PAYMENT_PROVIDER: "payme", PAYME_MERCHANT_ID: "m", PAYME_KEY: "k" });
    expect(c).toMatchObject({ provider: "payme", mode: "sandbox", payme: { merchantId: "m", key: "k", accountField: "order_id", enforceIp: false } });
  });
  it("live requires https site and enforces Payme IPs", () => {
    expect(() => loadPaymentConfig({ ...base, NEXT_PUBLIC_SITE_URL: "http://x", PAYMENT_PROVIDER: "payme", PAYMENT_MODE: "live", PAYME_MERCHANT_ID: "m", PAYME_KEY: "k" })).toThrow(/https/);
    expect(loadPaymentConfig({ ...base, PAYMENT_PROVIDER: "payme", PAYMENT_MODE: "live", PAYME_MERCHANT_ID: "m", PAYME_KEY: "k" }).payme!.enforceIp).toBe(true);
  });
  it("requires a strong ORDER_TOKEN_SECRET", () => {
    expect(() => loadPaymentConfig({ PAYMENT_PROVIDER: "mock", PAYMENT_WEBHOOK_SECRET: "s", ORDER_TOKEN_SECRET: "short" })).toThrow(/32/);
  });
});
