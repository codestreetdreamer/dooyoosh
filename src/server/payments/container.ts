/**
 * Composition root for route handlers. Owner: Payments & Orders.
 * Store selection (fail closed):
 *  - PAYMENTS_STORE=postgres (default, as in src/lib/env.ts) -> PgStore over DATABASE_URL (Backend's schema + functions).
 *    Missing/invalid DATABASE_URL -> throw on first payment call.
 *  - PAYMENTS_STORE=memory -> in-memory demo store (seeded only when PAYMENTS_DEMO_SEED=true); refused when
 *    NODE_ENV=production. Data is lost on restart.
 *  - any other value -> throw (never silently fall back to memory).
 */
import "server-only";
import { loadPaymentConfig } from "./config";
import type { PaymentDeps } from "./deps";
import type { PaymentProvider } from "./types";
import { createProvider } from "./registry";
import { MemoryStore } from "./memory-store";
import { createPgClient, PgStore } from "./pg-store";
import { seedDemo } from "./demo-seed";
import { logNotifier } from "../email/notifier";

type Payments = { deps: PaymentDeps; provider: PaymentProvider; providers: Map<string, PaymentProvider>; memory?: MemoryStore };
// Next may load this module once per route bundle. Only the memory store (data) is shared process-wide via globalThis;
// providers/services stay per bundle so `instanceof ApiError` in errors.ts keeps working (a shared provider instance
// from another bundle throws a different ApiError class -> 500 instead of 401).
const g = globalThis as unknown as { __dyMemoryStore?: MemoryStore; __dyPgStore?: PgStore };
let cached: Payments | undefined;

export function getPayments(): Payments {
  if (cached) return cached;
  const config = loadPaymentConfig(process.env);
  const now = () => new Date();
  const kind = process.env.PAYMENTS_STORE ?? "postgres";
  let store: MemoryStore | PgStore;
  if (kind === "postgres") {
    const url = process.env.DATABASE_URL;
    if (!url || !/^postgres(ql)?:\/\//.test(url)) throw new Error("PAYMENTS_STORE=postgres requires DATABASE_URL (postgres://...)");
    // one pool per process (Next may load this module once per route bundle)
    store = g.__dyPgStore ??= new PgStore(createPgClient(url));
  } else if (kind === "memory") {
    if (config.nodeEnv === "production") throw new Error("PAYMENTS_STORE=memory is not allowed in production");
    let mem = g.__dyMemoryStore;
    if (!mem) {
      mem = new MemoryStore(now);
      if (process.env.PAYMENTS_DEMO_SEED === "true") seedDemo(mem);
      g.__dyMemoryStore = mem;
    }
    store = mem;
  } else {
    throw new Error(`PAYMENTS_STORE must be "postgres" or "memory" (got ${JSON.stringify(kind)})`);
  }
  const deps: PaymentDeps = { repo: store, inventory: store, notifier: logNotifier, config, now };
  const provider = createProvider(config, deps);
  cached = { deps, provider, providers: new Map([[provider.name, provider]]), memory: store instanceof MemoryStore ? store : undefined };
  return cached;
}

/** Client IP for provider allow-lists. Platform-neutral: first hop of X-Forwarded-For, else X-Real-IP. */
export function clientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim() || null;
  return headers.get("x-real-ip");
}
