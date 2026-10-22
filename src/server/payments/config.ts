/**
 * Payment configuration + sandbox/live gating. Owner: Payments & Orders.
 *
 * Rules:
 *  - PAYMENT_MODE defaults to "sandbox". Only the exact string "live" enables live mode.
 *    Any other value (typo, "LIVE ", "production") is refused rather than silently treated as live or sandbox.
 *  - "mock" provider is refused in live mode and when NODE_ENV=production (spec §12.1; also enforced in src/lib/env.ts).
 *  - Secrets come only from env. Nothing is hardcoded. Missing credentials for the chosen provider -> throw.
 *  - Sandbox Payme uses the TEST_KEY from the cashbox and the test.paycom.uz checkout host.
 *  - Click has no separate sandbox host (docs.click.uz/testing/postman): in sandbox mode the customer is sent to our
 *    mock pay page, and Prepare/Complete are exercised with Click's Postman collection / playground.
 */
import type { PaymentProviderName } from "./types";

/** sandbox = test credentials / test hosts only, no real money. live = real money. */
export type PaymentMode = "sandbox" | "live";

const PROVIDERS: readonly PaymentProviderName[] = ["mock", "stripe", "payme", "click"];

export interface PaymentConfig {
  provider: PaymentProviderName;
  mode: PaymentMode;
  siteUrl: string;
  nodeEnv: string;
  /** HMAC key for deriving guest checkout/order tokens (token = HMAC(checkoutId)); only sha256(token) is stored. */
  tokenSecret: string;
  mock?: { webhookSecret: string };
  payme?: {
    merchantId: string;
    key: string;
    /** Basic-auth login. Payme docs: "запросите у технического специалиста Payme Business". Optional: if unset only the key is checked. */
    login?: string;
    /** account field configured in the Payme cashbox; we put our checkout id there. */
    accountField: string;
    /** enforce Payme source IPs 185.234.113.1-15 (developer.help.paycom.uz/protokol-merchant-api/skhema-vzaimodeystviya) */
    enforceIp: boolean;
  };
  click?: { serviceId: string; merchantId: string; secretKey: string };
}

export class PaymentConfigError extends Error {
  override name = "PaymentConfigError";
}

type Env = Record<string, string | undefined>;

function req(env: Env, key: string, why: string): string {
  const v = env[key];
  if (v === undefined || v.trim() === "") throw new PaymentConfigError(`${key} is required when ${why}`);
  return v;
}

export function resolveMode(raw: string | undefined): PaymentMode {
  if (raw === undefined || raw === "") return "sandbox";
  if (raw === "sandbox" || raw === "live") return raw;
  throw new PaymentConfigError(`PAYMENT_MODE must be "sandbox" or "live" (got ${JSON.stringify(raw)}); refusing to guess`);
}

export function loadPaymentConfig(env: Env = process.env): PaymentConfig {
  const mode = resolveMode(env.PAYMENT_MODE);
  const nodeEnv = env.NODE_ENV ?? "development";
  const provider = (env.PAYMENT_PROVIDER ?? "mock") as PaymentProviderName;
  if (!PROVIDERS.includes(provider)) throw new PaymentConfigError(`unknown PAYMENT_PROVIDER ${provider}`);
  const siteUrl = env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  if (provider === "mock" && (mode === "live" || nodeEnv === "production")) {
    throw new PaymentConfigError("mock payment provider is not allowed in live mode or NODE_ENV=production");
  }
  if (provider === "stripe") {
    throw new PaymentConfigError("stripe is not available: business is registered in Uzbekistan (spec v0.4)");
  }
  if (mode === "live" && !siteUrl.startsWith("https://")) {
    throw new PaymentConfigError("live mode requires an https NEXT_PUBLIC_SITE_URL");
  }

  const tokenSecret = req(env, "ORDER_TOKEN_SECRET", "creating checkouts (guest order tokens)");
  if (tokenSecret.length < 32) throw new PaymentConfigError("ORDER_TOKEN_SECRET must be at least 32 characters");
  const cfg: PaymentConfig = { provider, mode, siteUrl, nodeEnv, tokenSecret };
  if (provider === "mock") cfg.mock = { webhookSecret: req(env, "PAYMENT_WEBHOOK_SECRET", "PAYMENT_PROVIDER=mock") };
  if (provider === "payme") {
    cfg.payme = {
      merchantId: req(env, "PAYME_MERCHANT_ID", "PAYMENT_PROVIDER=payme"),
      key: req(env, "PAYME_KEY", "PAYMENT_PROVIDER=payme"),
      login: env.PAYME_LOGIN || undefined,
      accountField: env.PAYME_ACCOUNT_FIELD || "order_id",
      enforceIp: mode === "live",
    };
  }
  if (provider === "click") {
    cfg.click = {
      serviceId: req(env, "CLICK_SERVICE_ID", "PAYMENT_PROVIDER=click"),
      merchantId: req(env, "CLICK_MERCHANT_ID", "PAYMENT_PROVIDER=click"),
      secretKey: req(env, "CLICK_SECRET_KEY", "PAYMENT_PROVIDER=click"),
    };
  }
  return cfg;
}
