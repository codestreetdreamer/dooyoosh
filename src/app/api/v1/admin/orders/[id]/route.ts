/** GET /api/v1/admin/orders/{id} (CONTRACTS adminGetOrder). admin: owner, fulfilment. */
import { adminOrderResponse, idParams } from "@/contracts/admin";
import { withErrors } from "@/lib/errors";
import { getPayments } from "@/server/payments/container";
import { requireAdmin } from "@/server/orders/admin-auth";
import { adminGetOrder } from "@/server/orders/admin";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin(req, "orders");
  const { id } = idParams.parse(await ctx.params);
  return Response.json(adminOrderResponse.parse({ data: await adminGetOrder(getPayments().deps, id) }), { headers: { "Cache-Control": "no-store" } });
});
