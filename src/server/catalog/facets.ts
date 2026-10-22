/** GET /api/v1/products/facets service (owner: Backend & Database). public.product_facets() as anon (published + in stock). */
import "server-only";
import type { ProductFacetsResponse } from "@/contracts/catalog";
import { asAnon } from "../db/client";

export async function getProductFacets(category?: string): Promise<ProductFacetsResponse> {
  const [row] = await asAnon((tx) => tx<{ f: ProductFacetsResponse["data"] | null }[]>`select public.product_facets(${category ?? null}) as f`);
  return { data: row?.f ?? { sizes: [], colours: [], priceMinor: null } };
}
