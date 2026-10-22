/**
 * MockProvider: dev/test/sandbox only (spec §12.1; refused in live mode and NODE_ENV=production by config.ts).
 * Behaves like a hosted checkout + signed webhook (Stripe-style), so the generic pipeline in webhooks.ts is exercised
 * end to end without any network call.
 *
 * Signature header: `x-mock-signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`, 5 min tolerance.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/errors";
import { normalizedPaymentEvent, type CheckoutForPayment, type CreateSessionResult, type NormalizedPaymentEvent, type PaymentMode, type PaymentProvider, type RefundInput, type RefundResult, type VerifiedWebhook, type WebhookOutcome } from "./types";

export const MOCK_SIGNATURE_HEADER = "x-mock-signature";
const TOLERANCE_S = 300;

export function signMockPayload(secret: string, rawBody: string, t: number = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

export function verifyMockSignature(secret: string, rawBody: string, header: string | null, nowS: number = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isInteger(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) return false;
  if (Math.abs(nowS - t) > TOLERANCE_S) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"), "hex");
  const got = Buffer.from(v1, "hex");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export class MockProvider implements PaymentProvider {
  readonly name = "mock" as const;
  readonly supportedCurrencies = "any" as const;
  constructor(
    readonly mode: PaymentMode,
    private readonly secret: string,
    private readonly siteUrl: string,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (mode === "live") throw new Error("MockProvider cannot run in live mode");
  }

  async createSession(c: CheckoutForPayment): Promise<CreateSessionResult> {
    const u = new URL(`/${c.locale}/checkout/sandbox-pay`, this.siteUrl);
    u.searchParams.set("checkoutId", c.checkoutId);
    u.searchParams.set("provider", "mock");
    return { redirectUrl: u.toString(), providerSessionId: `mock_cs_${c.checkoutId}`, expiresAt: c.expiresAt };
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedWebhook> {
    const nowS = Math.floor(this.clock().getTime() / 1000);
    if (!verifyMockSignature(this.secret, rawBody, headers.get(MOCK_SIGNATURE_HEADER), nowS)) throw ApiError.unauthorized("invalid signature");
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw ApiError.validation("invalid JSON");
    }
    const ev = normalizedPaymentEvent.parse(parsed);
    if (ev.provider !== "mock") throw ApiError.validation("provider mismatch");
    return { events: [ev], respond: mockRespond };
  }

  async cancel(): Promise<void> {}

  async refund(input: RefundInput): Promise<RefundResult> {
    return { status: "succeeded", providerRefundId: `mock_re_${input.idempotencyKey}` };
  }
}

function mockRespond(outcome: WebhookOutcome) {
  const status = outcome.kind === "rejected" ? 400 : 200;
  return { status, body: JSON.stringify({ received: true, outcome: outcome.kind }), headers: { "content-type": "application/json" } };
}

export function mockEvent(e: Omit<NormalizedPaymentEvent, "provider">): NormalizedPaymentEvent {
  return { provider: "mock", ...e };
}
