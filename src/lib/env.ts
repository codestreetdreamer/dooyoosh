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

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.url(),
});

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
      need(["RESEND_API_KEY"], "NODE_ENV=production");
      if (env.PAYMENTS_STORE === "memory") {
        ctx.addIssue({ code: "custom", path: ["PAYMENTS_STORE"], message: "memory store is not allowed in production" });
      }
    }
    if (env.PAYMENT_MODE === "live") {
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

export type ClientEnv = z.infer<typeof clientSchema>;
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

export function parseClientEnv(source: Record<string, string | undefined>): ClientEnv {
  const r = clientSchema.safeParse(source);
  if (!r.success) throw new Error(`Invalid client environment:\n${format(r.error)}`);
  return r.data;
}

// NEXT_PUBLIC_* must be referenced literally so Next.js inlines them in the client bundle.
let cachedClient: ClientEnv | undefined;

/** Safe in the browser. Lazily validated so imports never throw at build time. */
export function clientEnv(): ClientEnv {
  cachedClient ??= parseClientEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });
  return cachedClient;
}

let cached: ServerEnv | undefined;

/** Server-only. Throws if called in the browser or if env is invalid. */
export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") throw new Error("serverEnv() must not be called in the browser");
  cached ??= parseServerEnv(process.env);
  return cached;
}
