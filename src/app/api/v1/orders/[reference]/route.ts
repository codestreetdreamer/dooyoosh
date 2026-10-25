/**
 * GET /api/v1/orders/{reference} (CONTRACTS getOrder). Token ONLY via `Authorization: Bearer <accessToken>`;
 * `?token=` -> 400. Unknown reference, missing/malformed or wrong token -> 404 (indistinguishable).
 */
import { getOrderResponse, orderParams } from "@/contracts/orders";
import { ApiError, withErrors } from "@/lib/errors";
import { getPayments } from "@/server/payments/container";
import { getPublicOrder } from "@/server/orders/view";
import { bearerToken, rejectQueryToken } from "@/server/checkout/bearer";
import { respond } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ reference: string }> }) => {
  rejectQueryToken(req);
  const p = orderParams.safeParse(await ctx.params);
  const token = bearerToken(req);
  if (!p.success || !token) throw ApiError.notFound();
  const data = await getPublicOrder(getPayments().deps, p.data.reference, token);
  return respond(getOrderResponse, { data }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
});
