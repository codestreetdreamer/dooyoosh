/**
 * Boot-time checks (Architect-owned). Runs once per server instance before any request.
 * production: invalid env aborts boot (mock + live, memory store, ADMIN_DEV_TOKEN, ...).
 * development/test: DB-only env is enough to boot; full serverEnv() problems are logged, and
 * payment/checkout routes still throw on first use via serverEnv().
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { serverEnv, dbEnv } = await import("@/lib/env");
  if (process.env.NODE_ENV === "production") {
    serverEnv();
    return;
  }
  dbEnv();
  try {
    serverEnv();
  } catch (e) {
    console.warn(`[env] full server env invalid (dev boot continues; payments/checkout will fail):\n${(e as Error).message}`);
  }
}
