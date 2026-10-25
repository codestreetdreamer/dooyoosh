/** GET /api/v1/shipping/options?country= (shipping.shippingOptionsQuery -> shipping.shippingOptionsResponse; 422 COUNTRY_NOT_SHIPPABLE). */
import { shippingOptionsQuery, shippingOptionsResponse } from "@/contracts/shipping";
import { withErrors } from "@/lib/errors";
import { parseQuery, respond } from "@/server/catalog/http";
import { shippingOptions } from "@/server/catalog/shipping-options";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (req: Request) =>
  respond(shippingOptionsResponse, { data: await shippingOptions(parseQuery(shippingOptionsQuery, req)) }),
);
