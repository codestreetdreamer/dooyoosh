/**
 * Guest token transport for GET /checkout/{id}/status and GET /orders/{reference} (contracts v0.5, main 12599c0):
 * ONLY `Authorization: Bearer <accessToken>`. A `token` query parameter is rejected with 400 so it never reaches
 * access logs, browser history or Referer headers. No query fallback.
 */
import { ApiError } from "@/lib/errors";

export function rejectQueryToken(req: Request): void {
  if (new URL(req.url).searchParams.has("token")) throw ApiError.validation("token must be sent as Authorization: Bearer <token>, never in the URL");
}

/** Returns the bearer token, or null when the header is missing/malformed or the token length is out of contract range. */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(h.trim());
  return m ? m[1]! : null;
}
