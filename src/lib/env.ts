/**
 * Zod-validated environment (Architect-owned, spec §2, §12).
 * - `clientEnv()`: only NEXT_PUBLIC_* values, safe in the browser.
 * - `serverEnv()`: lazily validated, server-only. Import from server code only.
 * Rule: `mock` payment provider is refused when NODE_ENV=production (spec §12.1).
 */
import { z } from "zod";

export const PAYMENT_PROVIDERS = ["mock", "stripe", "payme", "click"] as const;

const currencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, "ISO 4217 3-letter code, upper case");

const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : v));

import { clientSchema, parseClientEnv, clientEnv, type ClientEnv } from "./client-env";
export { parseClientEnv, clientEnv, type ClientEnv };


const serverSchema = clientSchema
  .extend({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    PAYMENT_PROVIDER: z.enum(PAYMENT_PROVIDERS).default("mock"),
    /** sandbox = test credentials/hosts; only the exact string "live" moves real money */
    PAYMENT_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
    /** MVP demo deploy only: lets the mock provider run on a production build. Never with PAYMENT_MODE=live. */
    ALLOW_MOCK_IN_PRODUCTION: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    PAYMENT_WEBHOOK_SECRET: optionalSecret,
    STRIPE_SECRET_KEY: optionalSecret,
    PAYME_MERCHANT_ID: optionalSecret,
    PAYME_KEY: optionalSecret,
    PAYME_LOGIN: optionalSecret,
    PAYME_ACCOUNT_FIELD: z.string().min(1).default("order_id"),
    CLICK_SERVICE_ID: optionalSecret,
    CLICK_MERCHANT_ID: optionalSecret,
    CLICK_SECRET_KEY: optionalSecret,
    RESEND_API_KEY: optionalSecret,
    EMAIL_FROM: z.string().min(3),
    DEFAULT_CURRENCY: currencyCode,
    CRON_SECRET: z.string().min(16),
    /** HMAC key for guest checkout/order access tokens (only the hash is stored) */
    ORDER_TOKEN_SECRET: z.string().min(32),
    /** memory = tests/local demo only; refused in production */
    PAYMENTS_STORE: z.enum(["postgres", "memory"]).default("postgres"),
    SANDBOX_SIMULATOR_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    PAYMENTS_DEMO_SEED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    ADMIN_DEV_TOKEN: optionalSecret,
    TRUSTED_IP_HEADER: z.string().min(1).default("x-vercel-forwarded-for"),
    NEWSLETTER_HASH_SECRET: optionalSecret.pipe(z.string().min(32).optional()),
  })
  .superRefine((env, ctx) => {
    const need = (keys: (keyof typeof env)[], why: string) => {
      for (const k of keys) {
        if (!env[k]) ctx.addIssue({ code: "custom", path: [k], message: `required when ${why}` });
      }
    };
    if (env.NODE_ENV === "production") {
      if (env.PAYMENT_PROVIDER === "mock" && !(env.PAYMENT_MODE === "sandbox" && env.ALLOW_MOCK_IN_PRODUCTION)) {
        ctx.addIssue({ code: "custom", path: ["PAYMENT_PROVIDER"], message: "mock in production requires PAYMENT_MODE=sandbox and ALLOW_MOCK_IN_PRODUCTION=true (MVP demo only)" });
      }
      need(["RESEND_API_KEY", "NEWSLETTER_HASH_SECRET"], "NODE_ENV=production");
      if (env.ADMIN_DEV_TOKEN) {
        ctx.addIssue({ code: "custom", path: ["ADMIN_DEV_TOKEN"], message: "not allowed in production" });
      }
      if (env.PAYMENTS_STORE === "memory") {
        ctx.addIssue({ code: "custom", path: ["PAYMENTS_STORE"], message: "memory store is not allowed in production" });
      }
    }
    if (env.NEXT_PUBLIC_PAYMENT_MODE !== env.PAYMENT_MODE) {
      ctx.addIssue({ code: "custom", path: ["NEXT_PUBLIC_PAYMENT_MODE"], message: "must equal PAYMENT_MODE" });
    }
    if (env.PAYMENT_MODE === "live") {
      if (env.SANDBOX_SIMULATOR_ENABLED) {
        ctx.addIssue({ code: "custom", path: ["SANDBOX_SIMULATOR_ENABLED"], message: "must be false when PAYMENT_MODE=live" });
      }
      if (env.ALLOW_MOCK_IN_PRODUCTION) {
        ctx.addIssue({ code: "custom", path: ["ALLOW_MOCK_IN_PRODUCTION"], message: "must be false when PAYMENT_MODE=live" });
      }
      if (env.PAYMENT_PROVIDER === "mock") {
        ctx.addIssue({ code: "custom", path: ["PAYMENT_PROVIDER"], message: "mock is not allowed in live mode" });
      }
      if (!env.NEXT_PUBLIC_SITE_URL.startsWith("https://")) {
        ctx.addIssue({ code: "custom", path: ["NEXT_PUBLIC_SITE_URL"], message: "live mode requires https" });
      }
    }
    switch (env.PAYMENT_PROVIDER) {
      case "mock":
        need(["PAYMENT_WEBHOOK_SECRET"], "PAYMENT_PROVIDER=mock");
        break;
      case "stripe":
        need(["STRIPE_SECRET_KEY", "PAYMENT_WEBHOOK_SECRET"], "PAYMENT_PROVIDER=stripe");
        break;
      case "payme":
        need(["PAYME_MERCHANT_ID", "PAYME_KEY", "PAYME_LOGIN"], "PAYMENT_PROVIDER=payme");
        break;
      case "click":
        need(["CLICK_SERVICE_ID", "CLICK_MERCHANT_ID", "CLICK_SECRET_KEY"], "PAYMENT_PROVIDER=click");
        break;
    }
  });

export type ServerEnv = z.infer<typeof serverSchema>;

function format(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
}

/** Parse an env-like object. Exported for tests. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const r = serverSchema.safeParse(source);
  if (!r.success) throw new Error(`Invalid server environment:\n${format(r.error)}`);
  return r.data;
}

/** Read-only catalog/journal routes: only DB + public vars. Does not require payment/email secrets. */
const dbSchema = clientSchema.extend({ DATABASE_URL: z.url() });
export type DbEnv = z.infer<typeof dbSchema>;
let cachedDb: DbEnv | undefined;
export function dbEnv(): DbEnv {
  if (typeof window !== "undefined") throw new Error("dbEnv() must not be called in the browser");
  if (!cachedDb) {
    const r = dbSchema.safeParse(process.env);
    if (!r.success) throw new Error(`Invalid DB environment:\n${format(r.error)}`);
    cachedDb = r.data;
  }
  return cachedDb;
}

let cached: ServerEnv | undefined;

/** Server-only. Throws if called in the browser or if env is invalid. */
export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") throw new Error("serverEnv() must not be called in the browser");
  cached ??= parseServerEnv(process.env);
  return cached;
}
