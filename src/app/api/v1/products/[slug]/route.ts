/** GET /api/v1/products/{slug} (catalog.productParams + getProductQuery -> catalog.getProductResponse). Owner: Backend & Database. */
import { getProductQuery, getProductResponse, productParams } from "@/contracts/catalog";
import { withErrors } from "@/lib/errors";
import { parseParams, parseQuery, respond } from "@/server/catalog/http";
import { getProduct } from "@/server/catalog/products";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = parseParams(productParams, await ctx.params);
  const { locale } = parseQuery(getProductQuery, req);
  return respond(getProductResponse, { data: await getProduct(slug, locale) });
});
