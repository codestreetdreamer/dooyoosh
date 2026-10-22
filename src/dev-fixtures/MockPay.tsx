"use client";
/** DEV FIXTURES — NOT PRODUCTION. Simulates the hosted payment page + provider callback. */
import { mockSettle } from "./mock-api";

export function MockPay({ checkoutId, token, locale }: { checkoutId: string; token: string; locale: string }) {
  const go = (outcome: "succeeded" | "failed") => {
    mockSettle(checkoutId, outcome);
    window.location.assign(`/${locale}/checkout/return?checkoutId=${encodeURIComponent(checkoutId)}&token=${encodeURIComponent(token)}`);
  };
  return (
    <div className="mt-10 flex flex-wrap gap-4">
      <button type="button" className="btn btn-primary" onClick={() => go("succeeded")}>Simulate successful payment</button>
      <button type="button" className="btn btn-outline" onClick={() => go("failed")}>Simulate failed payment</button>
    </div>
  );
}
