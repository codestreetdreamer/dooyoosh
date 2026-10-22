/** GET /api/v1/products/facets?category=&locale= (catalog.productFacetsQuery -> catalog.productFacetsResponse). Owner: Backend & Database. */
import { productFacetsQuery, productFacetsResponse } from "@/contracts/catalog";
import { withErrors } from "@/lib/errors";
import { getProductFacets } from "@/server/catalog/facets";
import { parseQuery, respond } from "@/server/catalog/http";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (req: Request) => {
  const q = parseQuery(productFacetsQuery, req);
  return respond(productFacetsResponse, await getProductFacets(q.category));
});
