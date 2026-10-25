/**
 * Response-side contract validation (QA P2). A request that fails its schema is the client's fault -> 400 (zod
 * errors thrown from *.parse on input, mapped by withErrors). Our OWN response failing its schema is a server bug ->
 * 500 INTERNAL, never 400. Logs only issue paths/codes, never the payload (it may carry an accessToken).
 */
import type { z } from "zod";
import { ApiError } from "@/lib/errors";

export function respond<S extends z.ZodType>(schema: S, payload: unknown, init: ResponseInit = {}): Response {
  const r = schema.safeParse(payload);
  if (!r.success) {
    console.error("[api] response failed its contract schema", r.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })));
    throw ApiError.internal();
  }
  return Response.json(r.data, init);
}
