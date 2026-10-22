/** GET /api/v1/orders/{reference}?token= (CONTRACTS getOrder). Unknown reference or wrong token -> 404. */
import { getOrderQuery, getOrderResponse, orderParams } from "@/contracts/orders";
import { ApiError, withErrors } from "@/lib/errors";
import { getPayments } from "@/server/payments/container";
import { getPublicOrder } from "@/server/orders/view";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ reference: string }> }) => {
  // malformed reference/token are indistinguishable from "not found" for the caller
  const p = orderParams.safeParse(await ctx.params);
  const q = getOrderQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.success || !q.success) throw ApiError.notFound();
  const data = await getPublicOrder(getPayments().deps, p.data.reference, q.data.token);
  return Response.json(getOrderResponse.parse({ data }), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
});
