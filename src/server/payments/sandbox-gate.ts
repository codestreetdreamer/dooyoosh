/**
 * Sandbox gates (QA P0). Pure functions over env so route handlers can call them as the VERY FIRST statement,
 * before parsing params, reading the body or touching the DB. A closed gate means HTTP 404 (the route "does not exist").
 *
 * Deployed Vercel sandboxes run NODE_ENV=production, so the gates key on PAYMENT_MODE plus an explicit opt-in flag
 * SANDBOX_SIMULATOR_ENABLED=true, never on NODE_ENV:
 *  - simulator open  <=> PAYMENT_MODE === "sandbox" (exact) && SANDBOX_SIMULATOR_ENABLED === "true" (exact)
 *                        && PAYMENT_PROVIDER in {mock, click} (Payme has its own official sandbox, test.paycom.uz)
 *  - mock provider   <=> never in live mode; under NODE_ENV=production only with PAYMENT_MODE=sandbox +
 *                        ALLOW_MOCK_IN_PRODUCTION=true (same rule as src/lib/env.ts, Architect b0b349f).
 * An unset PAYMENT_MODE does NOT open the simulator (config defaults to sandbox, the gate does not).
 */
type Env = Record<string, string | undefined>;

export const SANDBOX_CAPABLE_PROVIDERS = ["mock", "click"] as const;

export function sandboxFlagsOn(env: Env): boolean {
  return env.PAYMENT_MODE === "sandbox" && env.SANDBOX_SIMULATOR_ENABLED === "true";
}

export function sandboxSimulatorEnabled(env: Env): boolean {
  const p = env.PAYMENT_PROVIDER ?? "mock";
  return sandboxFlagsOn(env) && (SANDBOX_CAPABLE_PROVIDERS as readonly string[]).includes(p);
}

/** May the mock provider (and /webhooks/mock) exist at all? */
export function mockProviderAllowed(env: Env): boolean {
  if (env.PAYMENT_MODE === "live") return false;
  if ((env.NODE_ENV ?? "development") === "production") return env.PAYMENT_MODE === "sandbox" && env.ALLOW_MOCK_IN_PRODUCTION === "true";
  return (env.PAYMENT_MODE ?? "sandbox") === "sandbox";
}
