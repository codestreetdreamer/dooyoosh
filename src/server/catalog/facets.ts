/** GET /api/v1/products/facets service (owner: Backend & Database). public.product_facets() as anon (published + in stock). */
import "server-only";
import type { ProductFacetsResponse } from "@/contracts/catalog";
import { asAnon } from "../db/client";

const ALPHA = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
const SYSTEM_ORDER = ["alpha", "numeric", "eu_shoe", "uk_shoe", "us_shoe", "one_size"];

/** Natural size order: XS < S < M < L within alpha, numeric sizes by value, unknown labels last (alphabetical). */
function sizeKey(s: { value: string; sizeSystem: string }): [number, number, string] {
  const sys = SYSTEM_ORDER.indexOf(s.sizeSystem);
  const a = ALPHA.indexOf(s.value.toUpperCase());
  const n = Number.parseFloat(s.value.replace(",", "."));
  return [sys < 0 ? 99 : sys, a >= 0 ? a : Number.isFinite(n) ? n : 1e9, s.value];
}

export async function getProductFacets(category?: string): Promise<ProductFacetsResponse> {
  const [row] = await asAnon((tx) => tx<{ f: ProductFacetsResponse["data"] | null }[]>`select public.product_facets(${category ?? null}) as f`);
  const data = row?.f ?? { sizes: [], colours: [], priceMinor: null };
  data.sizes.sort((x, y) => {
    const a = sizeKey(x), b = sizeKey(y);
    return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]);
  });
  return { data };
}
