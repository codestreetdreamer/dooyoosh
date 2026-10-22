/** POST /api/v1/admin/orders/{id}/transition (CONTRACTS adminTransitionOrder). admin: owner, fulfilment. */
import { adminOrderResponse, idParams, transitionOrderRequest } from "@/contracts/admin";
import { withErrors } from "@/lib/errors";
import { getPayments } from "@/server/payments/container";
import { requireAdmin } from "@/server/orders/admin-auth";
import { adminTransitionOrder } from "@/server/orders/admin";

export const dynamic = "force-dynamic";

export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireAdmin(req, "orders");
  const { id } = idParams.parse(await ctx.params);
  const body = transitionOrderRequest.parse(await req.json().catch(() => null));
  const data = await adminTransitionOrder(getPayments().deps, id, body.to, body.note, actor);
  return Response.json(adminOrderResponse.parse({ data }), { headers: { "Cache-Control": "no-store" } });
});
