/**
 * Payme Business Merchant API protocol constants. Every value below is taken from the official docs:
 *  - request/response format:  https://developer.help.paycom.uz/protokol-merchant-api/format-zaprosa
 *                              https://developer.help.paycom.uz/protokol-merchant-api/format-otveta
 *  - auth + source IPs:         https://developer.help.paycom.uz/protokol-merchant-api/skhema-vzaimodeystviya
 *  - error codes:               https://developer.help.paycom.uz/metody-merchant-api/oshibki-errors
 *                              https://developer.help.paycom.uz/protokol-merchant-api/obschie-oshibki
 *  - states / reasons / types:  https://developer.help.paycom.uz/metody-merchant-api/tipy-dannykh
 *  - 12 h timeout:              https://developer.help.paycom.uz/metody-merchant-api/createtransaction
 *  - checkout URL (GET, base64):https://developer.help.paycom.uz/initsializatsiya-platezhey/otpravka-cheka-po-metodu-get
 *  - sandbox host:              https://developer.help.paycom.uz/pesochnitsa
 */
import { timingSafeEqual } from "node:crypto";

export const PAYME_ERRORS = {
  /** HTTP method is not POST */
  NOT_POST: -32300,
  /** JSON parse error */
  PARSE: -32700,
  /** required RPC fields missing / wrong types */
  INVALID_REQUEST: -32600,
  /** method not found (method name goes in `data`) */
  METHOD_NOT_FOUND: -32601,
  /** insufficient privileges (bad Basic auth) */
  UNAUTHORIZED: -32504,
  /** system (internal) error */
  SYSTEM: -32400,
  /** amount does not match the order */
  INVALID_AMOUNT: -31001,
  /** transaction not found */
  TXN_NOT_FOUND: -31003,
  /** cannot cancel: goods/service fully delivered */
  CANNOT_CANCEL: -31007,
  /** cannot perform the operation in the current state */
  CANNOT_PERFORM: -31008,
  /** -31050..-31099: errors in `account` (localized message required, `data` = account sub-field name) */
  ACCOUNT_NOT_FOUND: -31050,
  ACCOUNT_NOT_PAYABLE: -31051,
} as const;

export const PAYME_TIMEOUT_MS = 43_200_000; // 12 h, "Отмена по таймауту"

export const PAYME_REASON = {
  RECEIVER_NOT_FOUND: 1,
  DEBIT_ERROR: 2,
  EXECUTION_ERROR: 3,
  TIMEOUT: 4,
  REFUND: 5,
  UNKNOWN: 10,
} as const;

/** Payme sends requests only from these addresses (skhema-vzaimodeystviya). */
export const PAYME_IPS: readonly string[] = Array.from({ length: 15 }, (_, i) => `185.234.113.${i + 1}`);

export const PAYME_CHECKOUT_HOST = { sandbox: "https://test.paycom.uz", live: "https://checkout.paycom.uz" } as const;

export type Localized = { ru: string; uz: string; en: string };

export class PaymeRpcError extends Error {
  constructor(
    readonly code: number,
    readonly localized: Localized,
    readonly data?: unknown,
  ) {
    super(localized.en);
  }
}

export const MSG = {
  unauthorized: { ru: "Недостаточно привилегий для выполнения метода", uz: "Usulni bajarish uchun huquq yetarli emas", en: "Insufficient privileges" },
  amount: { ru: "Неверная сумма", uz: "Noto'g'ri summa", en: "Invalid amount" },
  notFound: { ru: "Транзакция не найдена", uz: "Tranzaksiya topilmadi", en: "Transaction not found" },
  cannotPerform: { ru: "Невозможно выполнить операцию", uz: "Amalni bajarib bo'lmaydi", en: "Unable to perform operation" },
  cannotCancel: { ru: "Заказ выполнен. Невозможно отменить транзакцию", uz: "Buyurtma bajarilgan. Tranzaksiyani bekor qilib bo'lmaydi", en: "Order fulfilled, cannot cancel" },
  orderNotFound: { ru: "Заказ не найден", uz: "Buyurtma topilmadi", en: "Order not found" },
  orderNotPayable: { ru: "Заказ недоступен для оплаты (истекло время брони)", uz: "Buyurtmani to'lab bo'lmaydi (bron muddati tugagan)", en: "Order cannot be paid (reservation expired)" },
  system: { ru: "Системная ошибка", uz: "Tizim xatosi", en: "System error" },
  badRequest: { ru: "Неверный RPC-запрос", uz: "Noto'g'ri RPC so'rov", en: "Invalid RPC request" },
  parse: { ru: "Ошибка парсинга JSON", uz: "JSON tahlil xatosi", en: "JSON parse error" },
  method: { ru: "Метод не найден", uz: "Usul topilmadi", en: "Method not found" },
  notPost: { ru: "Метод запроса не POST", uz: "So'rov usuli POST emas", en: "Request method is not POST" },
} satisfies Record<string, Localized>;

/**
 * Basic auth: `Authorization: Basic base64(login:password)`; password = cashbox key (TEST_KEY in the sandbox).
 * The login is issued by Payme support; if PAYME_LOGIN is not configured only the key is compared.
 * Constant-time comparison.
 */
export function verifyPaymeAuth(header: string | null, key: string, login?: string): boolean {
  if (!header || !header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  const i = decoded.indexOf(":");
  if (i < 0) return false;
  const eq = (a: string, b: string) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  };
  const keyOk = eq(decoded.slice(i + 1), key);
  const loginOk = login === undefined ? true : eq(decoded.slice(0, i), login);
  return keyOk && loginOk;
}

/** GET checkout URL: <host>/base64("m=<merchant>;ac.<field>=<checkoutId>;a=<tiyin>;l=<lang>;c=<return url>") */
export function buildPaymeCheckoutUrl(p: { host: string; merchantId: string; accountField: string; checkoutId: string; amountTiyin: number; lang: string; returnUrl: string }): string {
  const lang = ["ru", "uz", "en"].includes(p.lang) ? p.lang : "uz";
  const params = `m=${p.merchantId};ac.${p.accountField}=${p.checkoutId};a=${p.amountTiyin};l=${lang};c=${p.returnUrl}`;
  return `${p.host}/${Buffer.from(params, "utf8").toString("base64")}`;
}
