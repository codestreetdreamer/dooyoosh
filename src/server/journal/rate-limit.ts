/**
 * Newsletter rate limit, DB-backed (migration 0008, QA P3). Owner: Backend & Database.
 * public.newsletter_attempt() prunes (>24h), records and counts in one call; only hashes are stored.
 * Client IP is taken ONLY from a platform header we trust:
 *   TRUSTED_IP_HEADER (default "x-vercel-forwarded-for"); fallback "x-real-ip" only when VERCEL=1.
 * No trusted IP => per-email limit only (a spoofable header must never decide the limit key).
 */
import "server-only";
import { createHash, createHmac } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { getSql } from "../db/client";

export const NEWSLETTER_LIMITS = { ipLimit: 10, ipWindowMinutes: 10, emailLimit: 3, emailWindowMinutes: 60 } as const;

type LimiterEnv = { TRUSTED_IP_HEADER?: string; NEWSLETTER_HASH_SECRET?: string; VERCEL?: string };

/** Production: the validated serverEnv() (TRUSTED_IP_HEADER default + NEWSLETTER_HASH_SECRET required, >= 32 chars).
 *  Dev/test: the same keys from process.env, because these routes boot with dbEnv() only (main 0e6bdbc). */
function limiterEnv(): LimiterEnv {
  if (process.env.NODE_ENV === "production") {
    const e = serverEnv();
    return { TRUSTED_IP_HEADER: e.TRUSTED_IP_HEADER, NEWSLETTER_HASH_SECRET: e.NEWSLETTER_HASH_SECRET, VERCEL: process.env.VERCEL };
  }
  const secret = process.env.NEWSLETTER_HASH_SECRET || undefined;
  // same rule as env.ts (min 32) so a short dev secret fails loudly instead of silently weakening the hash
  if (secret !== undefined && secret.length < 32) throw new Error("Invalid environment: NEWSLETTER_HASH_SECRET must be at least 32 characters");
  return { TRUSTED_IP_HEADER: process.env.TRUSTED_IP_HEADER || undefined, NEWSLETTER_HASH_SECRET: secret, VERCEL: process.env.VERCEL };
}

/** Trusted client IP or null. */
export function clientIp(headers: Headers, env: LimiterEnv = limiterEnv()): string | null {
  const name = (env.TRUSTED_IP_HEADER || "x-vercel-forwarded-for").toLowerCase();
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  const ip = first(headers.get(name));
  if (ip) return ip.slice(0, 64);
  if (env.VERCEL === "1") return first(headers.get("x-real-ip"))?.slice(0, 64) ?? null;
  return null;
}

/** HMAC-SHA256 with NEWSLETTER_HASH_SECRET (required in production by env.ts); dev without it: domain-separated sha256. */
export function hashKey(kind: "ip" | "email", value: string, env: LimiterEnv = limiterEnv()): string {
  const msg = `dooyoosh:newsletter:${kind}:${value}`;
  const secret = env.NEWSLETTER_HASH_SECRET;
  return secret ? createHmac("sha256", secret).update(msg).digest("hex") : createHash("sha256").update(msg).digest("hex");
}

/** true = allowed. One DB round trip. */
export async function newsletterAllowed(ip: string | null, email: string): Promise<boolean> {
  const l = NEWSLETTER_LIMITS;
  const [row] = await getSql()<{ ok: boolean }[]>`
    select public.newsletter_attempt(${ip ? hashKey("ip", ip) : null}::text, ${hashKey("email", email)}::text,
      ${l.ipLimit}::int, make_interval(mins => ${l.ipWindowMinutes}), ${l.emailLimit}::int, make_interval(mins => ${l.emailWindowMinutes})) as ok`;
  return row?.ok === true;
}
