"use client";
/** DEV FIXTURES — NOT PRODUCTION. Simulates the hosted payment page + provider callback. Token comes from sessionStorage. */
import { mockSettle } from "./mock-api";
import { checkoutScope, useStoredToken } from "@/lib/store/url-token";

export function MockPay({ checkoutId, locale }: { checkoutId: string; locale: string }) {
  const token = useStoredToken(checkoutId ? checkoutScope(checkoutId) : null);
  const go = (outcome: "succeeded" | "failed") => {
    mockSettle(checkoutId, outcome);
    window.location.assign(`/${locale}/checkout/return?checkoutId=${encodeURIComponent(checkoutId)}`);
  };
  if (token === undefined) return null;
  return (
    <div className="mt-10 flex flex-wrap gap-4">
      <button type="button" className="btn btn-primary" disabled={!token} onClick={() => go("succeeded")}>Simulate successful payment</button>
      <button type="button" className="btn btn-outline" disabled={!token} onClick={() => go("failed")}>Simulate failed payment</button>
    </div>
  );
}
