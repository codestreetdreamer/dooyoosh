/** POST /api/v1/checkout (CONTRACTS createCheckout, 201). Thin: parse -> service -> respond. */
import { createCheckoutRequest, createCheckoutResponse } from "@/contracts/checkout";
import { ApiError, withErrors } from "@/lib/errors";
import { getPayments } from "@/server/payments/container";
import { createCheckout } from "@/server/checkout/service";

export const dynamic = "force-dynamic";

export const POST = withErrors(async (req: Request) => {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw ApiError.validation("Body must be JSON");
  }
  const body = createCheckoutRequest.parse(json);
  const { deps, provider } = getPayments();
  const data = await createCheckout(deps, provider, body);
  return Response.json(createCheckoutResponse.parse({ data }), { status: 201, headers: { "Cache-Control": "no-store" } });
});
