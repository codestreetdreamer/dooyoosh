/** GET /api/v1/checkout/{checkoutId}/status?token= (CONTRACTS checkoutStatus). Never marks anything paid. */
import { checkoutStatusParams, checkoutStatusQuery, checkoutStatusResponse } from "@/contracts/orders";
import { withErrors } from "@/lib/errors";
import { getPayments } from "@/server/payments/container";
import { getCheckoutStatus } from "@/server/checkout/service";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ checkoutId: string }> }) => {
  const { checkoutId } = checkoutStatusParams.parse(await ctx.params);
  const { token } = checkoutStatusQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  const data = await getCheckoutStatus(getPayments().deps, checkoutId, token);
  return Response.json(checkoutStatusResponse.parse({ data }), { headers: { "Cache-Control": "no-store" } });
});
