/**
 * Money helpers (spec §2, §12.3). Amounts are integer minor units of `currency`
 * (cents for EUR, tiyin for UZS). Never floats. DB columns are named `*_cents`.
 */

export type CurrencyCode = string; // ISO 4217, validated by contracts/common.ts

export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}

/** Minor-unit exponent per currency (ISO 4217). UZS officially has 2 (tiyin). */
const EXPONENT: Record<string, number> = { EUR: 2, UZS: 2, USD: 2, PLN: 2, GBP: 2, JPY: 0 };

/** Fraction digits shown to customers (UZS is displayed without tiyin). */
const DISPLAY_DIGITS: Record<string, number> = { UZS: 0 };

export function exponentOf(currency: CurrencyCode): number {
  return EXPONENT[currency.toUpperCase()] ?? 2;
}

export function assertMinor(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError(`amount must be a safe integer, got ${amountMinor}`);
}

export function money(amountMinor: number, currency: CurrencyCode): Money {
  assertMinor(amountMinor);
  return { amountMinor, currency: currency.toUpperCase() };
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`);
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function multiply(a: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) throw new RangeError("quantity must be an integer");
  return money(a.amountMinor * quantity, a.currency);
}

export function sum(items: Money[], currency: CurrencyCode): Money {
  return items.reduce((acc, m) => add(acc, m), money(0, currency));
}

/** Convert a decimal major-unit string ("12.50", "1250000") to minor units without float math. */
export function toMinor(major: string, currency: CurrencyCode): number {
  const exp = exponentOf(currency);
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(major.trim());
  if (!m) throw new Error(`invalid amount: ${major}`);
  const [, sign, int = "0", frac = ""] = m;
  if (frac.length > exp) throw new Error(`too many decimals for ${currency}: ${major}`);
  const minor = Number(int) * 10 ** exp + Number(frac.padEnd(exp, "0") || "0");
  assertMinor(minor);
  return sign ? -minor : minor;
}

/** Display formatting. UZS: "1 250 000 so'm" (no decimals); EUR: "€12.50" per locale. */
export function formatMoney(amountMinor: number, currency: CurrencyCode, locale = "en"): string {
  assertMinor(amountMinor);
  const cur = currency.toUpperCase();
  const exp = exponentOf(cur);
  const digits = DISPLAY_DIGITS[cur] ?? exp;
  const major = amountMinor / 10 ** exp;
  if (cur === "UZS") {
    const n = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, minimumFractionDigits: 0 })
      .format(Math.round(major))
      .replace(/,/g, "\u00a0");
    return locale.startsWith("ru") ? `${n}\u00a0сум` : `${n}\u00a0so\u2019m`;
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: cur,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(major);
}
