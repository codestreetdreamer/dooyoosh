/**
 * Shared primitives for all API contracts (spec §2, §5, §12). Architect-owned.
 * Money is integer minor units + ISO 4217 currency (never floats, never hardcoded EUR).
 */
import { z } from "zod";

export const uuid = z.uuid();
export const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120);
export const isoDateTime = z.iso.datetime({ offset: true });
export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const phone = z.string().regex(/^\+?[0-9 ()-]{6,20}$/);

/** ISO 4217 code. Market decides which one (spec §12.3). */
export const currency = z.string().regex(/^[A-Z]{3}$/);
export type Currency = z.infer<typeof currency>;

/** Integer minor units (cents / tiyin). */
export const amountMinor = z.number().int().safe();
export const nonNegativeMinor = amountMinor.nonnegative();

export const money = z.object({ amountMinor: nonNegativeMinor, currency });
export type Money = z.infer<typeof money>;

/** BCP 47-ish locale used in routes and translation tables. Launch set is [OPEN]. */
export const SUPPORTED_LOCALES = ["en", "uz", "ru"] as const;
export const locale = z.enum(SUPPORTED_LOCALES);
export type Locale = z.infer<typeof locale>;

export const countryIso2 = z.string().regex(/^[A-Z]{2}$/);

/** Spec §12.1 */
export const PAYMENT_PROVIDERS = ["mock", "stripe", "payme", "click"] as const;
export const paymentProvider = z.enum(PAYMENT_PROVIDERS);
export type PaymentProviderName = z.infer<typeof paymentProvider>;

// ---- Pagination (spec §5): { data: [...], page: { cursor, limit } } ----
export const DEFAULT_LIMIT = 24;
export const MAX_LIMIT = 100;
export const paginationQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export const pageInfo = z.object({ cursor: z.string().nullable(), limit: z.number().int() });
export const paginated = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item), page: pageInfo });
export type Paginated<T> = { data: T[]; page: z.infer<typeof pageInfo> };

/** Single-resource envelope: { data: T } */
export const single = <T extends z.ZodType>(item: T) => z.object({ data: item });

// ---- Errors (spec §5) ----
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "OUT_OF_STOCK",
  "PRICE_CHANGED",
  "COUNTRY_NOT_SHIPPABLE",
  "IDEMPOTENCY_CONFLICT",
  "PAYMENT_ERROR",
  "INTERNAL",
] as const;
export const errorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCode>;

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  OUT_OF_STOCK: 409,
  PRICE_CHANGED: 409,
  COUNTRY_NOT_SHIPPABLE: 422,
  /** same idempotencyKey, different payload hash */
  IDEMPOTENCY_CONFLICT: 409,
  PAYMENT_ERROR: 502,
  INTERNAL: 500,
};

export const errorEnvelope = z.object({
  error: z.object({
    code: errorCode,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).default({}),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelope>;

/** 409 details (spec §11). */
export const stockConflictDetails = z.object({ variantIds: z.array(uuid).min(1) });

export const address = z.object({
  fullName: z.string().min(1).max(120),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  region: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: countryIso2,
  phone: phone.optional(),
});
export type Address = z.infer<typeof address>;

/** Generic empty success body: { ok: true } */
export const ok = z.object({ ok: z.literal(true) });
