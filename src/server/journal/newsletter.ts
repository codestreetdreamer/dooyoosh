/**
 * Newsletter double opt-in (owner: Backend & Database). Table newsletter_subscribers is server-only (no RLS policies).
 * - signup: always the same outcome to the caller (no enumeration). New/pending/unsubscribed emails get a fresh token
 *   (only its sha256 hash is stored); confirmed emails are left alone. Idempotent: ON CONFLICT (email).
 * - confirm: token -> hash lookup; pending (token < 7 days old) or already confirmed => confirmed; otherwise 404.
 * Sending the confirmation email is NOT done here: `onToken` is the hook for Payments' email module (src/server/email).
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Locale } from "@/contracts/common";
import { ApiError } from "@/lib/errors";
import { getSql } from "../db/client";

export const CONFIRM_TOKEN_TTL_DAYS = 7;
const hash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export async function signup(
  email: string,
  locale: Locale,
  onToken?: (args: { email: string; locale: Locale; token: string }) => Promise<void>,
): Promise<void> {
  const token = randomBytes(32).toString("base64url"); // 43 chars, within contract 32..128
  const rows = await getSql()<{ id: string }[]>`
    insert into public.newsletter_subscribers (email, locale, status, confirm_token_hash)
    values (${email}, ${locale}, 'pending', ${hash(token)})
    on conflict (email) do update
       set confirm_token_hash = excluded.confirm_token_hash, locale = excluded.locale,
           status = 'pending', unsubscribed_at = null
     where public.newsletter_subscribers.status <> 'confirmed'
    returning id`;
  if (rows.length && onToken) await onToken({ email, locale, token });
}

export async function confirm(token: string): Promise<void> {
  const rows = await getSql()<{ id: string }[]>`
    update public.newsletter_subscribers
       set status = 'confirmed', confirmed_at = coalesce(confirmed_at, now())
     where confirm_token_hash = ${hash(token)}
       and (status = 'confirmed' or (status = 'pending' and updated_at > now() - make_interval(days => ${CONFIRM_TOKEN_TTL_DAYS})))
    returning id`;
  if (!rows.length) throw ApiError.notFound("Invalid or expired confirmation link");
}
