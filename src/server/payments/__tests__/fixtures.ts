import { randomUUID } from "node:crypto";
import type { CreateCheckoutRequest } from "@/contracts/checkout";
import { MemoryStore } from "../memory-store";
import type { PaymentConfig } from "../config";
import type { PaymentDeps } from "../deps";
import type { PaymentProvider } from "../types";
import { createProvider } from "../registry";
import type { OrderNotifier } from "../../email/notifier";

export const SECRET = "whsec_test_0123456789abcdef0123456789";
export const TOKEN_SECRET = "tok_test_0123456789abcdef0123456789abcdef";
export const PAYME_KEY = "TEST_KEY_abcdefghijklmnopqrstuvwxyz12";
export const CLICK_SECRET = "click_secret_test";

export class Clock {
  t: number;
  constructor(iso = "2026-10-22T12:00:00.000Z") { this.t = Date.parse(iso); }
  now = () => new Date(this.t);
  advanceMin(m: number) { this.t += m * 60_000; }
}

export function silentNotifier(): OrderNotifier & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async orderPaid(e) { calls.push(`paid:${e.reference}`); },
    async stockConflict(e) { calls.push(`conflict:${e.reference}:${e.refund}`); },
    async orderRefunded(e) { calls.push(`refunded:${e.reference}`); },
    async manualRefundRequired(e) { calls.push(`manual:${e.reference}`); },
  };
}

export function setup(providerName: "mock" | "payme" | "click" = "mock", opts: { mode?: "sandbox" | "live"; stock?: number; fiscal?: boolean } = {}) {
  const clock = new Clock();
  const store = new MemoryStore(clock.now);
  const notifier = silentNotifier();
  const config: PaymentConfig = {
    provider: providerName, mode: opts.mode ?? "sandbox", siteUrl: "https://shop.example", nodeEnv: "test", tokenSecret: TOKEN_SECRET,
    mock: { webhookSecret: SECRET },
    payme: { merchantId: "587f72c72cac0d162c722ae2", key: PAYME_KEY, login: "Paycom", accountField: "order_id", enforceIp: false },
    click: { serviceId: "123", merchantId: "456", secretKey: CLICK_SECRET },
  };
  const deps: PaymentDeps = { repo: store, inventory: store, notifier, config, now: clock.now };
  const provider: PaymentProvider = createProvider(config, deps);
  const v1 = randomUUID();
  const v2 = randomUUID();
  const fiscal = opts.fiscal ? { ikpuCode: "06109001001000000", packageCode: "1500889", vatRateBp: 1200 } : {};
  store.addVariant({ variantId: v1, sku: "DEMO-TEE-M", productName: "Linen tee", size: "M", unitPriceMinor: 25_000_000, currency: "UZS", stockOnHand: opts.stock ?? 5, weightGrams: 300, ...fiscal });
  store.addVariant({ variantId: v2, sku: "DEMO-BAG", productName: "Tote bag", unitPriceMinor: 12_000_000, currency: "UZS", stockOnHand: opts.stock ?? 5, weightGrams: 400, ...fiscal });
  const methodId = randomUUID();
  store.addShippingMethod({ methodId, name: "Tashkent courier", isActive: true, marketCurrency: "UZS", marketActive: true, countries: ["UZ"], rates: [{ minSubtotalMinor: 0, maxWeightGrams: null, priceMinor: 3_000_000, freeOverMinor: 100_000_000 }] });
  const request = (over: Partial<CreateCheckoutRequest> = {}): CreateCheckoutRequest => ({
    email: "buyer@example.com", locale: "en", items: [{ variantId: v1, quantity: 2 }, { variantId: v2, quantity: 1 }],
    shippingAddress: { fullName: "Test Buyer", line1: "Amir Temur 1", city: "Tashkent", country: "UZ" }, shippingMethodId: methodId, ...over,
  });
  return { clock, store, deps, provider, notifier, v1, v2, methodId, request };
}
