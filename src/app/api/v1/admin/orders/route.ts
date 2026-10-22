/** GET /api/v1/admin/orders (CONTRACTS adminListOrders). admin: owner, fulfilment. */
import { adminListOrdersQuery, adminListOrdersResponse } from "@/contracts/admin";
import { withErrors } from "@/lib/errors";
import { getPayments } from "@/server/payments/container";
import { requireAdmin } from "@/server/orders/admin-auth";
import { adminListOrders } from "@/server/orders/admin";
import { respond } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (req: Request) => {
  await requireAdmin(req, "orders");
  const q = adminListOrdersQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  const body = await adminListOrders(getPayments().deps, q);
  return respond(adminListOrdersResponse, body, { headers: { "Cache-Control": "no-store" } });
});
