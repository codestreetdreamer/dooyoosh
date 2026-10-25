"use client";
import { useState } from "react";
import { checkoutScope, useStoredToken } from "@/lib/store/url-token";
import { call } from "@/lib/store/data-source";
import { ErrorState } from "@/components/ui/States";
import { DemoBanner } from "@/components/layout/DemoBanner";

/**
 * Sandbox payment page for the mock/Click sandbox providers (Payments & Orders' redirectUrl:
 * /{locale}/checkout/sandbox-pay?checkoutId=&token=). Calls POST /api/v1/checkout/{id}/sandbox-pay, which pushes a
 * SIGNED provider callback through the normal webhook pipeline (404 unless the sandbox gate is open), then goes to
 * the return page, which reads the result from the server. No real money moves.
 * Uses the typed `sandboxPay` endpoint (contract: token travels in the JSON body of the same-origin POST — never in a
 * URL, never logged). Token source: sessionStorage only (accessToken saved from the POST /checkout response).
 */
export function SandboxPay({ checkoutId, locale }: { checkoutId: string | null; locale: string }) {
  const token = useStoredToken(checkoutId ? checkoutScope(checkoutId) : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (token === undefined) return null;
  if (!checkoutId || !token) {
    return <ErrorState title="Sandbox payment session not found">Open this page from the same browser tab you checked out in.</ErrorState>;
  }

  const pay = async (outcome: "success" | "fail") => {
    setBusy(true);
    setError(null);
    const res = await call("sandboxPay", { params: { checkoutId }, body: { token, outcome } });
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
