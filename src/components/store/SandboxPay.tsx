"use client";
import { useState } from "react";
import { useUrlToken } from "@/lib/store/url-token";
import { call } from "@/lib/store/data-source";
import { ErrorState } from "@/components/ui/States";
import { DemoBanner } from "@/components/layout/DemoBanner";

/**
 * Sandbox payment page for the mock/Click sandbox providers (Payments & Orders' redirectUrl:
 * /{locale}/checkout/sandbox-pay?checkoutId=&token=). Calls POST /api/v1/checkout/{id}/sandbox-pay, which pushes a
 * SIGNED provider callback through the normal webhook pipeline (404 unless the sandbox gate is open), then goes to
 * the return page, which reads the result from the server. No real money moves.
 * Uses the typed `sandboxPay` endpoint (contract: token travels as a query param of the same-origin POST — never in
 * the address bar, never logged).
 */
export function SandboxPay({ checkoutId, locale }: { checkoutId: string | null; locale: string }) {
  const token = useUrlToken(checkoutId ? `checkout:${checkoutId}` : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (token === undefined) return null;
  if (!checkoutId || !token) {
    return <ErrorState title="Sandbox payment link is incomplete">The link is missing the checkout id or access token.</ErrorState>;
  }

  const pay = async (outcome: "success" | "fail") => {
    setBusy(true);
    setError(null);
    const res = await call("sandboxPay", { params: { checkoutId }, query: { token, outcome } });
    if (!res.ok) {
      setBusy(false);
      setError(
        res.status === 404 ? "The sandbox simulator is not enabled on this deployment."
        : res.status === 0 ? "Network error — please try again."
        : `Sandbox payment failed (${res.error.code}).`,
      );
      return;
    }
    // The return page reads the token from sessionStorage (same scope), so it is NOT put back into a URL.
    window.location.assign(`/${locale}/checkout/return?checkoutId=${encodeURIComponent(checkoutId)}`);
  };

  return (
    <div>
      <div className="mt-8"><DemoBanner variant="inline" /></div>
      <div className="mt-6 flex flex-wrap gap-4">
        <button type="button" disabled={busy} className="btn btn-primary" onClick={() => void pay("success")}>Simulate successful payment</button>
        <button type="button" disabled={busy} className="btn btn-outline" onClick={() => void pay("fail")}>Simulate failed payment</button>
      </div>
      {error ? <p role="alert" className="mt-6 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
