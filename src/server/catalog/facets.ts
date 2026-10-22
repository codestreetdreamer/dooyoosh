/** GET /api/v1/products/facets service (owner: Backend & Database). Reads public.product_facets() (invoker, published + in stock). */
import "server-only";
import { sql } from "drizzle-orm";
import { productFacetsResponse, type ProductFacetsResponse } from "@/contracts/catalog";
import { getDb } from "../db/client";

export async function getProductFacets(category?: string): Promise<ProductFacetsResponse> {
  const r = await getDb().execute(sql`select public.product_facets(${category ?? null}) as f`);
  const row = (Array.isArray(r) ? r[0] : (r as { rows?: unknown[] }).rows?.[0]) as { f: unknown } | undefined;
  return productFacetsResponse.parse({ data: row?.f ?? { sizes: [], colours: [], priceMinor: null } });
}
