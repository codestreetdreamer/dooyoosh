/**
 * POST /api/v1/cron/release-expired (CONTRACTS cronReleaseExpired). Auth: Authorization: Bearer $CRON_SECRET.
 * GET is accepted too because Vercel Cron issues GET requests; any scheduler that can send the header works.
 */
import { timingSafeEqual } from "node:crypto";
import { releaseExpiredResponse } from "@/contracts/inventory";
import { ApiError, withErrors } from "@/lib/errors";
import { getPayments } from "@/server/payments/container";
import { releaseExpiredCheckouts } from "@/server/checkout/service";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16) return false;
  const a = Buffer.from(`Bearer ${secret}`);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

const handler = withErrors(async (req: Request) => {
  if (!authorized(req)) throw ApiError.unauthorized();
  const { deps, provider } = getPayments();
  const data = await releaseExpiredCheckouts(deps, provider);
  return Response.json(releaseExpiredResponse.parse({ data }), { headers: { "Cache-Control": "no-store" } });
});

export const POST = handler;
export const GET = handler;
