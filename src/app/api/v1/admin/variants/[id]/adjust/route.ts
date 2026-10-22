/** POST /api/v1/admin/variants/{id}/adjust (CONTRACTS adminAdjustStock) -> adjust_stock(). admin: owner, fulfilment. */
import { adjustStockRequest, adjustStockResponse, idParams } from "@/contracts/admin";
import { withErrors } from "@/lib/errors";
import { getPayments } from "@/server/payments/container";
import { requireAdmin } from "@/server/orders/admin-auth";
import { adminAdjustStock } from "@/server/orders/admin";
import { respond } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireAdmin(req, "inventory");
  const { id } = idParams.parse(await ctx.params);
  const body = adjustStockRequest.parse(await req.json().catch(() => null));
  const data = await adminAdjustStock(getPayments().deps, id, body, actor);
  return respond(adjustStockResponse, { data }, { headers: { "Cache-Control": "no-store" } });
});
