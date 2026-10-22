/** Thin route-handler helpers for Backend-owned public routes: parse(contract) -> service -> respond(contract). */
import "server-only";
import type { z } from "zod";
import { ApiError } from "@/lib/errors";

export function parseQuery<S extends z.ZodType>(schema: S, req: Request): z.output<S> {
  const sp = new URL(req.url).searchParams;
  const obj: Record<string, string> = {};
  for (const [k, v] of sp) {
    if (k in obj) throw ApiError.validation("Invalid query", [{ path: [k], message: "Duplicate parameter" }]);
    obj[k] = v;
  }
  const r = schema.safeParse(obj);
  if (!r.success) throw ApiError.validation("Invalid query", r.error.issues);
  return r.data;
}

export function parseParams<S extends z.ZodType>(schema: S, params: unknown): z.output<S> {
  const r = schema.safeParse(params);
  if (!r.success) throw ApiError.validation("Invalid path parameter", r.error.issues);
  return r.data;
}

const MAX_BODY_BYTES = 32 * 1024;

export async function parseBody<S extends z.ZodType>(schema: S, req: Request): Promise<z.output<S>> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) throw ApiError.validation("Content-Type must be application/json");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw ApiError.validation("Request body too large");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw ApiError.validation("Malformed JSON body");
  }
  const r = schema.safeParse(json);
  if (!r.success) throw ApiError.validation("Invalid request body", r.error.issues);
  return r.data;
}

export const CACHE_PUBLIC = "public, s-maxage=60, stale-while-revalidate=300";
export const CACHE_NONE = "no-store";

/** Validate the outgoing body against the response contract (a mismatch is a server bug => 500, logged). */
export function respond<S extends z.ZodType>(schema: S, body: z.input<S>, init: { status?: number; cache?: string } = {}): Response {
  const r = schema.safeParse(body);
  if (!r.success) {
    console.error("[api] response does not match contract", JSON.stringify(r.error.issues).slice(0, 2000));
    throw ApiError.internal();
  }
  return Response.json(r.data, { status: init.status ?? 200, headers: { "Cache-Control": init.cache ?? CACHE_PUBLIC } });
}
