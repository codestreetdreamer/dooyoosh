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
  // contract shape + accessToken (raw guest token, only ever in this body; see service.ts CheckoutData)
  const parsed = createCheckoutResponse.parse({ data });
  return Response.json({ data: { ...parsed.data, accessToken: data.accessToken } }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
