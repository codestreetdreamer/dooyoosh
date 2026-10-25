import { formatMoney } from "@/lib/money";

/** Always formats from integer minor units + currency (never hardcoded). */
export function Price({ amountMinor, currency, locale = "en", from = false, className }: {
  amountMinor: number; currency: string; locale?: string; from?: boolean; className?: string;
}) {
  return (
    <span className={className} data-testid="price">
      {from ? <span className="sr-only">From </span> : null}
      {formatMoney(amountMinor, currency, locale)}
    </span>
  );
}
