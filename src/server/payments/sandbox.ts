/**
 * Sandbox payment simulator (POST /api/v1/checkout/{id}/sandbox-pay?token=&outcome=success|fail).
 * 404 unless PAYMENT_MODE=sandbox + SANDBOX_SIMULATOR_ENABLED=true and provider mock|click (sandbox-gate.ts). It builds the SAME signed callback the provider
 * would send and pushes it through the normal webhook pipeline, so nothing bypasses signature/amount checks.
 * Payme is not simulated here: use the official sandbox at https://test.paycom.uz (developer.help.paycom.uz/pesochnitsa).
 */
import { ApiError } from "@/lib/errors";
import type { PaymentProvider } from "./types";
import type { PaymentDeps } from "./deps";
import { signMockPayload, MOCK_SIGNATURE_HEADER } from "./mock";
import { clickSignString, minorToClickAmount } from "./click/protocol";
import { handleWebhook } from "./webhooks";
import { tokenMatches } from "../checkout/token";

export async function simulateSandboxPayment(deps: PaymentDeps, provider: PaymentProvider, checkoutId: string, token: string, outcome: "success" | "fail") {
  // defence in depth; the route already returned 404 via sandboxSimulatorEnabled(process.env)
  if (provider.mode !== "sandbox" || (provider.name !== "mock" && provider.name !== "click")) throw ApiError.notFound();
  const c = await deps.repo.getCheckout(checkoutId);
  if (!c || !tokenMatches(token, c.accessTokenHash)) throw ApiError.notFound();
  const meta = { method: "POST", ip: null };

  if (provider.name === "mock") {
    const ev = { provider: "mock", eventId: `sim_${checkoutId}_${outcome}`, type: outcome === "success" ? "payment.succeeded" : "payment.failed", providerPaymentId: `mock_pi_${checkoutId}`, amountMinor: c.totalMinor, currency: c.currency, checkoutId };
    const raw = JSON.stringify(ev);
    const headers = new Headers({ [MOCK_SIGNATURE_HEADER]: signMockPayload(deps.config.mock!.webhookSecret, raw, Math.floor(deps.now().getTime() / 1000)) });
    return [await handleWebhook(deps, provider, raw, headers, meta)];
  }
  if (provider.name === "click") {
    const k = deps.config.click!;
    const clickTransId = String(Date.now());
    const signTime = deps.now().toISOString().replace("T", " ").slice(0, 19);
    const amount = minorToClickAmount(c.totalMinor, c.currency);
    const form = (f: Record<string, string>) => {
      const sign = clickSignString({ click_trans_id: f.click_trans_id!, service_id: f.service_id!, merchant_trans_id: f.merchant_trans_id!, merchant_prepare_id: f.merchant_prepare_id, amount: f.amount!, action: f.action!, sign_time: f.sign_time! }, k.secretKey);
      return new URLSearchParams({ ...f, sign_string: sign }).toString();
    };
    const common = { click_trans_id: clickTransId, service_id: k.serviceId, click_paydoc_id: clickTransId, merchant_trans_id: checkoutId, amount, sign_time: signTime, error_note: "Success" };
    const prep = await handleWebhook(deps, provider, form({ ...common, action: "0", error: "0" }), new Headers(), meta);
    const prepId = String((JSON.parse(prep.body) as { merchant_prepare_id?: number }).merchant_prepare_id ?? "");
    const comp = await handleWebhook(deps, provider, form({ ...common, action: "1", merchant_prepare_id: prepId, error: outcome === "success" ? "0" : "-5017" }), new Headers(), meta);
    return [prep, comp];
  }
  throw ApiError.validation(`no simulator for ${provider.name}; use the provider's sandbox`);
}
