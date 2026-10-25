/** env.ts guards (Architect 429251c) + that they actually run at boot. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const ENV_FILE = path.join(ROOT, "src/lib/env.ts");
const src = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
const HAS = src.includes("parseServerEnv") && src.includes("NEXT_PUBLIC_PAYMENT_MODE");

const base = {
  NODE_ENV: "production", DATABASE_URL: "postgres://u:p@localhost:5432/db", SUPABASE_SERVICE_ROLE_KEY: "x", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "x", NEXT_PUBLIC_SITE_URL: "https://shop.example", EMAIL_FROM: "a@b.c", RESEND_API_KEY: "x", CRON_SECRET: "c".repeat(32),
  ORDER_TOKEN_SECRET: "o".repeat(40), PAYMENT_WEBHOOK_SECRET: "w".repeat(32), PAYMENTS_STORE: "postgres", DEFAULT_CURRENCY: "UZS", NEWSLETTER_HASH_SECRET: "n".repeat(32), NEXT_PUBLIC_DEFAULT_CURRENCY: "UZS",
  PAYME_MERCHANT_ID: "m", PAYME_KEY: "k".repeat(20), CLICK_SERVICE_ID: "1", CLICK_MERCHANT_ID: "2", CLICK_SECRET_KEY: "s".repeat(10),
};

describe.skipIf(!HAS)("env.ts payment-mode guards", () => {
  const load = async () => (await import("@/lib/env")) as unknown as { parseServerEnv: (e: Record<string, string | undefined>) => unknown };
  it("PAYMENT_MODE=live + ALLOW_MOCK_IN_PRODUCTION=true is refused", async () => {
    const { parseServerEnv } = await load();
    expect(() => parseServerEnv({ ...base, PAYMENT_PROVIDER: "payme", PAYMENT_MODE: "live", NEXT_PUBLIC_PAYMENT_MODE: "live", ALLOW_MOCK_IN_PRODUCTION: "true" })).toThrow(/ALLOW_MOCK_IN_PRODUCTION/);
  });
  it("PAYMENT_MODE=live + PAYMENT_PROVIDER=mock is refused", async () => {
    const { parseServerEnv } = await load();
    expect(() => parseServerEnv({ ...base, PAYMENT_PROVIDER: "mock", PAYMENT_MODE: "live", NEXT_PUBLIC_PAYMENT_MODE: "live" })).toThrow(/PAYMENT_PROVIDER/);
  });
  it("NEXT_PUBLIC_PAYMENT_MODE must equal PAYMENT_MODE (both directions, and missing public var)", async () => {
    const { parseServerEnv } = await load();
    expect(() => parseServerEnv({ ...base, PAYMENT_PROVIDER: "payme", PAYMENT_MODE: "live", NEXT_PUBLIC_PAYMENT_MODE: "sandbox" })).toThrow(/NEXT_PUBLIC_PAYMENT_MODE/);
    expect(() => parseServerEnv({ ...base, PAYMENT_PROVIDER: "payme", PAYMENT_MODE: "sandbox", NEXT_PUBLIC_PAYMENT_MODE: "live" })).toThrow(/NEXT_PUBLIC_PAYMENT_MODE/);
    expect(() => parseServerEnv({ ...base, PAYMENT_PROVIDER: "payme", PAYMENT_MODE: "live" })).toThrow(/NEXT_PUBLIC_PAYMENT_MODE/);
  });
  it("a consistent sandbox demo config parses", async () => {
    const { parseServerEnv } = await load();
    expect(() => parseServerEnv({ ...base, PAYMENT_PROVIDER: "mock", PAYMENT_MODE: "sandbox", NEXT_PUBLIC_PAYMENT_MODE: "sandbox", ALLOW_MOCK_IN_PRODUCTION: "true" })).not.toThrow();
  });
  it("the guard runs at boot: instrumentation.ts register() calls serverEnv()/parseServerEnv (otherwise it is dead code)", () => {
    const f = ["src/instrumentation.ts", "instrumentation.ts"].map((x) => path.join(ROOT, x)).find((x) => fs.existsSync(x));
    expect(f, "no instrumentation.ts: nothing validates env at startup").toBeTruthy();
    expect(fs.readFileSync(f!, "utf8")).toMatch(/serverEnv\(|parseServerEnv\(/);
  });
});
