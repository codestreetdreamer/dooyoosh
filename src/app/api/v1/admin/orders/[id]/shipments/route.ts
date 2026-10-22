/** POST /api/v1/admin/orders/{id}/shipments (CONTRACTS adminCreateShipment) -> order shipped + email. admin: owner, fulfilment. */
import { createShipmentRequest, createShipmentResponse, idParams } from "@/contracts/admin";
import { withErrors } from "@/lib/errors";
import { getPayments } from "@/server/payments/container";
import { requireAdmin } from "@/server/orders/admin-auth";
import { adminCreateShipment } from "@/server/orders/admin";

export const dynamic = "force-dynamic";

export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireAdmin(req, "shipments");
  const { id } = idParams.parse(await ctx.params);
  const body = createShipmentRequest.parse(await req.json().catch(() => null));
  const data = await adminCreateShipment(getPayments().deps, id, body, actor);
  return Response.json(createShipmentResponse.parse({ data }), { status: 201, headers: { "Cache-Control": "no-store" } });
});
