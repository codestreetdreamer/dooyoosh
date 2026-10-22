/**
 * Frontend data access (Frontend & Design). Every call goes through Architect's typed `api()` client
 * (OWNERSHIP rule 1) — EXCEPT when the dev fixture layer is explicitly enabled.
 *
 * Fixtures are used only when NEXT_PUBLIC_USE_FIXTURES === "true" AND the build is not a Vercel production
 * deployment (NEXT_PUBLIC_VERCEL_ENV !== "production"). A banner is shown on every page while active.
 */
import { api, type ApiResult, type RequestArgs } from "@/lib/api-client";
import type { EndpointName } from "@/contracts";

export function usingFixtures(): boolean {
  return process.env.NEXT_PUBLIC_USE_FIXTURES === "true" && process.env.NEXT_PUBLIC_VERCEL_ENV !== "production";
}

/** Absolute origin for server-side fetches to our own /api/v1 (route handlers live in the same app). */
function serverOrigin(): string {
  return process.env.INTERNAL_API_ORIGIN ?? process.env.NEXT_PUBLIC_SITE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
}

export async function call<N extends EndpointName>(name: N, args: RequestArgs<N> = {} as RequestArgs<N>): Promise<ApiResult<N>> {
  if (usingFixtures()) {
    const { mockApi } = await import("@/dev-fixtures/mock-api");
    return mockApi(name, args);
  }
  const baseUrl = typeof window === "undefined" ? serverOrigin() : "";
  return api(name, { ...args, baseUrl } as RequestArgs<N>);
}
