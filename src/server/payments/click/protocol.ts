/**
 * Click SHOP API protocol (Click calls our Prepare / Complete). Sources (official):
 *  - requests + sign_string:  https://docs.click.uz/shop-api/requests  (en: https://docs.click.uz/en/shop-api/requests)
 *      Prepare  (action=0): md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + amount + action + sign_time)
 *      Complete (action=1): md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + merchant_prepare_id + amount + action + sign_time)
 *      Request: application/x-www-form-urlencoded; response: application/json. `amount` is in SOUMS ("N.NN").
 *  - error codes:             https://docs.click.uz/shop-api/errors   (en: https://docs.click.uz/en/shop-api/errors)
 *  - test scenarios:          https://docs.click.uz/en/testing/postman (signature uses the amount string exactly as sent)
 *  - payment button URL:      https://docs.click.uz/en/click-button  (my.click.uz/services/pay?service_id&merchant_id&amount&transaction_param&return_url)
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { exponentOf } from "@/lib/money";

export const CLICK_ERRORS = {
  SUCCESS: { error: 0, error_note: "Success" },
  SIGN_FAILED: { error: -1, error_note: "SIGN CHECK FAILED!" },
  BAD_AMOUNT: { error: -2, error_note: "Incorrect parameter amount" },
  ACTION_NOT_FOUND: { error: -3, error_note: "Action not found" },
  ALREADY_PAID: { error: -4, error_note: "Already paid" },
  USER_NOT_FOUND: { error: -5, error_note: "User does not exist" },
  TXN_NOT_FOUND: { error: -6, error_note: "Transaction does not exist" },
  UPDATE_FAILED: { error: -7, error_note: "Failed to update user" },
  BAD_REQUEST: { error: -8, error_note: "Error in request from click" },
  CANCELLED: { error: -9, error_note: "Transaction cancelled" },
} as const;

export const CLICK_PAY_URL = "https://my.click.uz/services/pay";

export interface ClickRequest {
  click_trans_id: string;
  service_id: string;
  click_paydoc_id: string;
  merchant_trans_id: string;
  merchant_prepare_id?: string;
  amount: string;
  action: string;
  error: string;
  error_note: string;
  sign_time: string;
  sign_string: string;
}

const REQUIRED = ["click_trans_id", "service_id", "click_paydoc_id", "merchant_trans_id", "amount", "action", "error", "sign_time", "sign_string"] as const;

export function parseClickBody(raw: string): ClickRequest | null {
  const f = new URLSearchParams(raw);
  for (const k of REQUIRED) if (!f.get(k)) return null;
  if (f.get("action") === "1" && !f.get("merchant_prepare_id")) return null;
  return {
    click_trans_id: f.get("click_trans_id")!, service_id: f.get("service_id")!, click_paydoc_id: f.get("click_paydoc_id")!,
    merchant_trans_id: f.get("merchant_trans_id")!, merchant_prepare_id: f.get("merchant_prepare_id") ?? undefined,
    amount: f.get("amount")!, action: f.get("action")!, error: f.get("error")!, error_note: f.get("error_note") ?? "",
    sign_time: f.get("sign_time")!, sign_string: f.get("sign_string")!,
  };
}

export function clickSignString(r: Omit<ClickRequest, "sign_string" | "click_paydoc_id" | "error" | "error_note">, secretKey: string): string {
  const prepareId = r.action === "1" ? (r.merchant_prepare_id ?? "") : "";
  return createHash("md5").update(`${r.click_trans_id}${r.service_id}${secretKey}${r.merchant_trans_id}${prepareId}${r.amount}${r.action}${r.sign_time}`).digest("hex");
}

export function verifyClickSign(r: ClickRequest, secretKey: string): boolean {
  if (!/^[0-9a-f]{32}$/i.test(r.sign_string)) return false;
  const a = Buffer.from(clickSignString(r, secretKey), "hex");
  const b = Buffer.from(r.sign_string.toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** "15000" / "15000.5" / "15000.50" soums -> 1500000 / 1500050 tiyin. Rejects more than 2 decimals and floats like 1e5. */
export function clickAmountToMinor(amount: string, currency: string): number | null {
  const exp = exponentOf(currency);
  const m = /^(\d{1,15})(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(exp, "0");
  const v = Number(m[1]) * 10 ** exp + Number(frac || "0");
  return Number.isSafeInteger(v) ? v : null;
}

/** minor -> "N.NN" (Click button `amount` format). */
export function minorToClickAmount(minor: number, currency: string): string {
  const exp = exponentOf(currency);
  const div = 10 ** exp;
  return exp === 0 ? String(minor) : `${Math.floor(minor / div)}.${String(minor % div).padStart(exp, "0")}`;
}
