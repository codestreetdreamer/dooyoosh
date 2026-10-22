/** POST /api/v1/admin/orders/{id}/refund (CONTRACTS adminRefundOrder). admin: owner, fulfilment. 201 new, 200 replay. */
import { idParams, refundOrderRequest, refundOrderResponse } from "@/contracts/admin";
import { withErrors } from "@/lib/errors";
import { getPayments } from "@/server/payments/container";
import { requireAdmin } from "@/server/orders/admin-auth";
import { adminRefundOrder } from "@/server/orders/admin";

export const dynamic = "force-dynamic";

export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireAdmin(req, "orders");
  const { id } = idParams.parse(await ctx.params);
  const body = refundOrderRequest.parse(await req.json().catch(() => null));
  const { deps, providers } = getPayments();
  const r = await adminRefundOrder(deps, providers, id, body, actor);
  return Response.json(refundOrderResponse.parse({ data: r.refund }), { status: r.created ? 201 : 200, headers: { "Cache-Control": "no-store" } });
});
