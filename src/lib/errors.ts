/**
 * API error model (spec §5, §11). Every non-2xx response body is:
 *   { "error": { "code": "OUT_OF_STOCK", "message": "...", "details": {} } }
 * 409 OUT_OF_STOCK / PRICE_CHANGED always carry details.variantIds (spec §11).
 */
import { ERROR_CODES, ERROR_STATUS, type ErrorCode, type ErrorEnvelope } from "@/contracts/common";

export { ERROR_CODES, ERROR_STATUS, type ErrorCode };

export type ErrorDetails = Record<string, unknown>;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, message: string, details: ErrorDetails = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }

  toJSON(): ErrorEnvelope {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }

  static validation(message: string, issues: unknown = []) {
    return new ApiError("VALIDATION_ERROR", message, { issues });
  }
  static unauthorized(message = "Authentication required") {
    return new ApiError("UNAUTHORIZED", message);
  }
  static forbidden(message = "Not allowed") {
    return new ApiError("FORBIDDEN", message);
  }
  static notFound(message = "Not found") {
    return new ApiError("NOT_FOUND", message);
  }
  static outOfStock(variantIds: string[], message = "Some items are no longer available") {
    return new ApiError("OUT_OF_STOCK", message, { variantIds });
  }
  static priceChanged(variantIds: string[], message = "Prices have changed, please review your bag") {
    return new ApiError("PRICE_CHANGED", message, { variantIds });
  }
  static countryNotShippable(country: string) {
    return new ApiError("COUNTRY_NOT_SHIPPABLE", "We do not ship to this country yet", { country });
  }
  static payment(message = "Payment provider error", details: ErrorDetails = {}) {
    return new ApiError("PAYMENT_ERROR", message, details);
  }
  static internal(message = "Something went wrong") {
    return new ApiError("INTERNAL", message);
  }
}

/** Duck-typed: `instanceof` fails across Next.js bundles (route vs instrumentation vs edge). */
export function isApiError(e: unknown): e is ApiError {
  if (e instanceof ApiError) return true;
  if (typeof e !== "object" || e === null) return false;
  const o = e as { name?: unknown; code?: unknown; status?: unknown; toJSON?: unknown };
  return o.name === "ApiError" && typeof o.code === "string" && (ERROR_CODES as readonly string[]).includes(o.code) && typeof o.status === "number" && typeof o.toJSON === "function";
}

/** Build the JSON error Response. Unknown errors become INTERNAL with no leaked detail. */
export function errorResponse(e: unknown, init: ResponseInit = {}): Response {
  const err = isApiError(e) ? e : isZodLike(e) ? ApiError.validation("Invalid request", e.issues) : ApiError.internal();
  if (!isApiError(e) && !isZodLike(e)) console.error("[api] unhandled error", e);
  return Response.json(err.toJSON(), {
    ...init,
    status: err.status,
    headers: { "Cache-Control": "no-store", ...(init.headers ?? {}) },
  });
}

function isZodLike(e: unknown): e is { name: string; issues: unknown[] } {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "ZodError" && Array.isArray((e as { issues?: unknown }).issues);
}

/** Wrap a route handler so thrown errors become the standard envelope. */
export function withErrors<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
