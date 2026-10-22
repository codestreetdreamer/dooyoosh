/** GET /api/v1/products/facets?category=&locale= (contract: catalog.productFacetsQuery -> catalog.productFacetsResponse). */
import { productFacetsQuery } from "@/contracts/catalog";
import { ApiError, withErrors } from "@/lib/errors";
import { getProductFacets } from "@/server/catalog/facets";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (req: Request) => {
  const q = productFacetsQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) throw ApiError.validation("Invalid query", q.error.issues);
  const body = await getProductFacets(q.data.category);
  return Response.json(body, { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } });
});
