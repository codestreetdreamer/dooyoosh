/**
 * Boot-time checks (Architect-owned). Runs once per server instance before any request.
 * Fails fast on invalid env (e.g. mock + live, memory store in production) instead of at first checkout.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { serverEnv } = await import("@/lib/env");
  serverEnv();
}
