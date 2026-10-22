/**
 * POST /api/v1/checkout (CONTRACTS createCheckout). Thin: parse -> service -> respond.
 *  - new checkout: 201, body = contracts createCheckoutResponse (accessToken = derived guest token, see checkout/token.ts)
 *  - replay (same idempotencyKey + same payload): 200, same checkout data, same accessToken
 *  - same idempotencyKey + different payload: 409 { error: { code: "IDEMPOTENCY_CONFLICT" } }
 */
import { createCheckoutRequest, createCheckoutResponse } from "@/contracts/checkout";
import { ApiError, withErrors } from "@/lib/errors";
import { getPayments } from "@/server/payments/container";
import { createCheckout } from "@/server/checkout/service";
import { respond } from "@/server/http/respond";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export const POST = withErrors(async (req: Request) => {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw ApiError.validation("Body must be JSON");
  }
  const body = createCheckoutRequest.parse(json);
  const { deps, provider } = getPayments();
  const result = await createCheckout(deps, provider, body);
  const { replayed, ...data } = result;
  return respond(createCheckoutResponse, { data }, { status: replayed ? 200 : 201, headers: NO_STORE });
});
