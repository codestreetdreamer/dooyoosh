/**
 * POST /api/v1/checkout/{checkoutId}/sandbox-pay  body: {"token": "...", "outcome": "success"|"fail"}
 * Sandbox only (sandbox-gate.ts): 404 before anything else when the gate is closed.
 * QA P1: the token travels in the JSON body only. A `token` in the query string is rejected (400) so it never ends up
 * in access logs (contracts payments.sandboxPayRequest, main cfd5cee).
 */
import { z } from "zod";
import { ApiError, errorResponse, withErrors } from "@/lib/errors";
import { sandboxPayRequest, sandboxPayResponse } from "@/contracts/payments";
import { getPayments } from "@/server/payments/container";
import { sandboxSimulatorEnabled } from "@/server/payments/sandbox-gate";
import { simulateSandboxPayment } from "@/server/payments/sandbox";

export const dynamic = "force-dynamic";
const body = sandboxPayRequest.strict();

const handler = withErrors(async (req: Request, ctx: { params: Promise<{ checkoutId: string }> }) => {
  if (new URL(req.url).searchParams.has("token")) throw ApiError.validation("token must be sent in the JSON body, not the URL");
  const { checkoutId } = z.object({ checkoutId: z.uuid() }).parse(await ctx.params);
  const { token, outcome } = body.parse(await req.json().catch(() => null));
  const { deps, provider } = getPayments();
  const results = await simulateSandboxPayment(deps, provider, checkoutId, token, outcome);
  const data = { callbacks: results.map((r) => ({ status: r.status, body: JSON.parse(r.body) as unknown })) };
  return Response.json(sandboxPayResponse.parse({ data }), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
});

/** QA P0: closed gate -> 404 before params, body, config or DB are touched. */
export async function POST(req: Request, ctx: { params: Promise<{ checkoutId: string }> }) {
  if (!sandboxSimulatorEnabled(process.env)) return errorResponse(ApiError.notFound());
  return handler(req, ctx);
}
