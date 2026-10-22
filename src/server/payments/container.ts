/**
 * Composition root for route handlers. Owner: Payments & Orders.
 * Store selection:
 *  - PAYMENTS_STORE=memory -> in-memory demo store (refused when NODE_ENV=production). Data is lost on restart.
 *  - otherwise the Postgres implementation, which is NOT written yet: it waits for Backend's docs/DATABASE.md and
 *    src/server/inventory/reservations.ts. Until then this throws a clear error instead of half-working.
 */
import "server-only";
import { loadPaymentConfig } from "./config";
import type { PaymentDeps } from "./deps";
import type { PaymentProvider } from "./types";
import { createProvider } from "./registry";
import { MemoryStore } from "./memory-store";
import { logNotifier } from "../email/notifier";

let cached: { deps: PaymentDeps; provider: PaymentProvider; providers: Map<string, PaymentProvider> } | undefined;

export function getPayments() {
  if (cached) return cached;
  const config = loadPaymentConfig(process.env);
  const now = () => new Date();
  if (process.env.PAYMENTS_STORE !== "memory") {
    throw new Error("Postgres payments store not wired yet (waiting for docs/DATABASE.md + src/server/inventory/reservations.ts). Set PAYMENTS_STORE=memory for a local demo.");
  }
  if (config.nodeEnv === "production") throw new Error("PAYMENTS_STORE=memory is not allowed in production");
  const store = new MemoryStore(now);
  const deps: PaymentDeps = { repo: store, inventory: store, notifier: logNotifier, config, now };
  const provider = createProvider(config, deps);
  cached = { deps, provider, providers: new Map([[provider.name, provider]]) };
  return cached;
}

/** Client IP for provider allow-lists. Platform-neutral: first hop of X-Forwarded-For, else X-Real-IP. */
export function clientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim() || null;
  return headers.get("x-real-ip");
}
