/**
 * GET /api/v1/checkout/{checkoutId}/status (CONTRACTS checkoutStatus). Never marks anything paid.
 * Token ONLY via `Authorization: Bearer <accessToken>`; `?token=` -> 400; missing/malformed header -> 400;
 * unknown id or wrong token -> 404.
 */
import { checkoutStatusParams, checkoutStatusResponse } from "@/contracts/orders";
import { ApiError, withErrors } from "@/lib/errors";
import { getPayments } from "@/server/payments/container";
import { getCheckoutStatus } from "@/server/checkout/service";
import { bearerToken, rejectQueryToken } from "@/server/checkout/bearer";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ checkoutId: string }> }) => {
  rejectQueryToken(req);
  const { checkoutId } = checkoutStatusParams.parse(await ctx.params);
  const token = bearerToken(req);
  if (!token) throw ApiError.validation("Authorization: Bearer <accessToken> is required");
  const data = await getCheckoutStatus(getPayments().deps, checkoutId, token);
  return Response.json(checkoutStatusResponse.parse({ data }), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
});
