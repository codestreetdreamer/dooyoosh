/**
 * Newsletter rate limit, DB-backed (migration 0008, QA P3). Owner: Backend & Database.
 * public.newsletter_attempt() prunes (>24h), records and counts in one call; only hashes are stored.
 * Client IP is taken ONLY from a platform header we trust:
 *   TRUSTED_IP_HEADER (default "x-vercel-forwarded-for"); fallback "x-real-ip" only when VERCEL=1.
 * No trusted IP => per-email limit only (a spoofable header must never decide the limit key).
 */
import "server-only";
import { createHash, createHmac } from "node:crypto";
import { getSql } from "../db/client";

export const NEWSLETTER_LIMITS = { ipLimit: 10, ipWindowMinutes: 10, emailLimit: 3, emailWindowMinutes: 60 } as const;

/** Trusted client IP or null. Reads process.env at call time (optional vars; not part of dbEnv()). */
export function clientIp(headers: Headers, env: Record<string, string | undefined> = process.env): string | null {
  const name = (env.TRUSTED_IP_HEADER || "x-vercel-forwarded-for").toLowerCase();
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  const ip = first(headers.get(name));
  if (ip) return ip.slice(0, 64);
  if (env.VERCEL === "1") return first(headers.get("x-real-ip"))?.slice(0, 64) ?? null;
  return null;
}

/** HMAC-SHA256 with NEWSLETTER_HASH_SECRET when set (recommended), else domain-separated sha256. Lower-case hex. */
export function hashKey(kind: "ip" | "email", value: string, env: Record<string, string | undefined> = process.env): string {
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
