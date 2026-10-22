/**
 * Frontend data access (Frontend & Design). Every call goes through Architect's typed `api()` client
 * (OWNERSHIP rule 1) — EXCEPT when the dev fixture layer is explicitly enabled.
 *
 * Fixtures are used only when allowed by ./fixtures-guard.ts (which fails production builds that request them).
 * A banner is shown on every page while active.
 */
import { api, type ApiResult, type RequestArgs } from "@/lib/api-client";
import type { EndpointName } from "@/contracts";
import { FIXTURES_ENABLED } from "./fixtures-guard";

export function usingFixtures(): boolean {
  return FIXTURES_ENABLED;
}

/** Absolute origin for server-side fetches to our own /api/v1 (route handlers live in the same app). */
function serverOrigin(): string {
  return process.env.INTERNAL_API_ORIGIN ?? process.env.NEXT_PUBLIC_SITE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
}

/**
 * NEXT_PUBLIC_FIXTURES_SCOPE=catalog (with fixtures enabled): catalog/journal/cart/shipping come from fixtures, but
 * checkout, checkout status and orders go to the REAL /api/v1 routes (Payments & Orders) — for integration testing
 * before Backend's catalog API exists. Default scope "all" mocks everything.
 */
const REAL_IN_CATALOG_SCOPE: readonly EndpointName[] = ["createCheckout", "checkoutStatus", "sandboxPay", "getOrder"];

export async function call<N extends EndpointName>(name: N, args: RequestArgs<N> = {} as RequestArgs<N>): Promise<ApiResult<N>> {
  const catalogOnly = process.env.NEXT_PUBLIC_FIXTURES_SCOPE === "catalog";
  if (FIXTURES_ENABLED && !(catalogOnly && REAL_IN_CATALOG_SCOPE.includes(name))) {
    const { mockApi } = await import("@/dev-fixtures/mock-api");
    return mockApi(name, args);
  }
  const baseUrl = typeof window === "undefined" ? serverOrigin() : "";
  return api(name, { ...args, baseUrl } as RequestArgs<N>);
}
