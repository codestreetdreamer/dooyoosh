/**
 * Typed client for /api/v1 (Architect-owned). Frontend calls the API ONLY through this (OWNERSHIP rule 1).
 * Types come from src/contracts; responses are validated at runtime in development.
 *
 *   const res = await api("listProducts", { query: { category: "footwear" } });
 *   if (!res.ok) showError(res.error.code); else render(res.data.data);
 */
import type { z } from "zod";
import { endpoints, errorEnvelope, type EndpointName, type Endpoints, type ErrorEnvelope } from "@/contracts";

type Def<N extends EndpointName> = Endpoints[N];
type In<T> = T extends z.ZodType ? z.input<T> : never;
type Out<T> = T extends z.ZodType ? z.output<T> : unknown;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- `{} extends T` detects all-optional inputs
type MaybeKey<K extends string, T> = [T] extends [never] ? { [P in K]?: never } : {} extends T ? { [P in K]?: T } : { [P in K]: T };

export type RequestArgs<N extends EndpointName> = MaybeKey<"params", In<Def<N> extends { params: infer P } ? P : never>> &
  MaybeKey<"query", In<Def<N> extends { query: infer Q } ? Q : never>> &
  MaybeKey<"body", In<Def<N> extends { body: infer B } ? B : never>> & {
    signal?: AbortSignal;
    headers?: Record<string, string>;
    /** absolute origin for server-side calls; default "" (same origin) */
    baseUrl?: string;
  };

export type ResponseOf<N extends EndpointName> = Out<Def<N> extends { response: infer R } ? R : never>;

export type ApiResult<N extends EndpointName> =
  | { ok: true; status: number; data: ResponseOf<N> }
  | { ok: false; status: number; error: ErrorEnvelope["error"] };

const API_BASE = "/api/v1";

export function buildPath(template: string, params?: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = params?.[key];
    if (v === undefined || v === null || v === "") throw new Error(`missing path param: ${key}`);
    return encodeURIComponent(String(v));
  });
}

export function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export async function api<N extends EndpointName>(name: N, args: RequestArgs<N> = {} as RequestArgs<N>): Promise<ApiResult<N>> {
  const def = endpoints[name] as Endpoints[EndpointName] & { body?: z.ZodType; response?: z.ZodType };
  const a = args as { params?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown; signal?: AbortSignal; headers?: Record<string, string>; baseUrl?: string };

  // Validate the request body client-side for early, friendly errors (server re-validates).
  let body: string | undefined;
  if (def.body) {
    const parsed = def.body.safeParse(a.body ?? {});
    if (!parsed.success) {
      return {
        ok: false,
        status: 400,
        error: { code: "VALIDATION_ERROR", message: "Invalid request", details: { issues: parsed.error.issues } },
      };
    }
    body = JSON.stringify(a.body ?? {});
  }

  const url = `${a.baseUrl ?? ""}${API_BASE}${buildPath(def.path, a.params)}${buildQuery(a.query)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: def.method,
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...a.headers },
      body,
      signal: a.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    return { ok: false, status: 0, error: { code: "INTERNAL", message: "Network error", details: {} } };
  }

  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const env = errorEnvelope.safeParse(json);
    return {
      ok: false,
      status: res.status,
      error: env.success ? env.data.error : { code: "INTERNAL", message: `HTTP ${res.status}`, details: {} },
    };
  }

  if (def.response && process.env.NODE_ENV !== "production") {
    const check = def.response.safeParse(json);
    if (!check.success) console.warn(`[api-client] ${String(name)} response does not match contract`, check.error.issues);
  }
  return { ok: true, status: res.status, data: json as ResponseOf<N> };
}
