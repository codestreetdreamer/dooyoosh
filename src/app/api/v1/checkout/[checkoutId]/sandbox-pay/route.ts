/** POST /api/v1/checkout/{checkoutId}/sandbox-pay?token=&outcome= — sandbox only (see server/payments/sandbox.ts). */
import { z } from "zod";
import { ApiError, errorResponse, withErrors } from "@/lib/errors";
import { sandboxSimulatorEnabled } from "@/server/payments/sandbox-gate";
import { getPayments } from "@/server/payments/container";
import { simulateSandboxPayment } from "@/server/payments/sandbox";

export const dynamic = "force-dynamic";
const query = z.object({ token: z.string().min(32).max(128), outcome: z.enum(["success", "fail"]).default("success") });

const handler = withErrors(async (req: Request, ctx: { params: Promise<{ checkoutId: string }> }) => {
  const { checkoutId } = z.object({ checkoutId: z.uuid() }).parse(await ctx.params);
  const { token, outcome } = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { deps, provider } = getPayments();
  const results = await simulateSandboxPayment(deps, provider, checkoutId, token, outcome);
  return Response.json({ data: { callbacks: results.map((r) => ({ status: r.status, body: JSON.parse(r.body) as unknown })) } }, { headers: { "Cache-Control": "no-store" } });
});

/** QA P0: closed gate -> 404 before params, body, config or DB are touched. */
export async function POST(req: Request, ctx: { params: Promise<{ checkoutId: string }> }) {
  if (!sandboxSimulatorEnabled(process.env)) return errorResponse(ApiError.notFound());
  return handler(req, ctx);
}
