/**
 * POST /api/v1/webhooks/{provider} (CONTRACTS paymentWebhook). Body is read as RAW text before anything else,
 * because signatures (mock HMAC, Click MD5) are computed over the exact bytes (spec §11).
 * Payme/Click always get HTTP 200 with their own error bodies (handled inside the adapters).
 */
import { webhookParams } from "@/contracts/payments";
import { errorResponse, ApiError } from "@/lib/errors";
import { clientIp, getPayments } from "@/server/payments/container";
import { handleWebhook } from "@/server/payments/webhooks";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  try {
    const { provider: name } = webhookParams.parse(await ctx.params);
    const { deps, providers } = getPayments();
    const provider = providers.get(name);
    if (!provider) throw ApiError.notFound("provider not enabled");
    const rawBody = await req.text();
    const r = await handleWebhook(deps, provider, rawBody, req.headers, { method: req.method, ip: clientIp(req.headers) });
    return new Response(r.body, { status: r.status, headers: r.headers });
  } catch (e) {
    return errorResponse(e);
  }
}
