/** Build the configured PaymentProvider. No Vercel-specific assumptions (spec §13). */
import type { PaymentProvider } from "./types";
import type { PaymentConfig } from "./config";
import type { PaymentDeps } from "./deps";
import { MockProvider } from "./mock";
import { PaymeAdapter } from "./payme/adapter";
import { ClickAdapter } from "./click/adapter";

export function createProvider(config: PaymentConfig, deps: Omit<PaymentDeps, "config">): PaymentProvider {
  const full: PaymentDeps = { ...deps, config };
  switch (config.provider) {
    case "mock":
      return new MockProvider(config.mode, config.mock!.webhookSecret, config.siteUrl, deps.now);
    case "payme":
      return new PaymeAdapter(config.mode, config.payme!, full);
    case "click":
      return new ClickAdapter(config.mode, config.click!, full);
    default:
      throw new Error(`payment provider ${config.provider} is not supported`);
  }
}
