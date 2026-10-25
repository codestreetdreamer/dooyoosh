/**
 * POST /api/v1/newsletter (journal.newsletterSignupRequest -> 202 journal.newsletterSignupResponse). Owner: Backend & Database.
 * Same 202 body for new/existing/confirmed emails, honeypot hits and rate-limited callers (no enumeration, no bot feedback).
 */
import { newsletterSignupRequest, newsletterSignupResponse } from "@/contracts/journal";
import { withErrors } from "@/lib/errors";
import { CACHE_NONE, parseBody, respond } from "@/server/catalog/http";
import { signup } from "@/server/journal/newsletter";
import { clientIp, newsletterAllowed } from "@/server/journal/rate-limit";

export const dynamic = "force-dynamic";

const ACCEPTED = { data: { status: "pending_confirmation" as const } };

export const POST = withErrors(async (req: Request) => {
  const raw = await req.clone().json().catch(() => null) as { website?: unknown } | null;
  const honeypot = typeof raw?.website === "string" && raw.website.length > 0;
  const body = honeypot ? null : await parseBody(newsletterSignupRequest, req);
  // DB-backed limit (0008): per trusted IP 10/10 min + per email 3/h; over the limit => same 202, nothing written
  if (body && (await newsletterAllowed(clientIp(req.headers), body.email))) await signup(body.email, body.locale);
  return respond(newsletterSignupResponse, ACCEPTED, { status: 202, cache: CACHE_NONE });
});
