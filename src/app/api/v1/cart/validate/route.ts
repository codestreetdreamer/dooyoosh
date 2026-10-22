/** POST /api/v1/cart/validate (cart.validateCartRequest -> cart.validateCartResponse). Owner: Backend & Database. */
import { validateCartRequest, validateCartResponse } from "@/contracts/cart";
import { withErrors } from "@/lib/errors";
import { validateCart } from "@/server/catalog/cart";
import { CACHE_NONE, parseBody, respond } from "@/server/catalog/http";

export const dynamic = "force-dynamic";

export const POST = withErrors(async (req: Request) =>
  respond(validateCartResponse, { data: await validateCart(await parseBody(validateCartRequest, req)) }, { cache: CACHE_NONE }),
);
