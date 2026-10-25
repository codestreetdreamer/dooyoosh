/** GET /api/v1/categories (catalog.listCategoriesQuery -> catalog.listCategoriesResponse). Owner: Backend & Database. */
import { listCategoriesQuery, listCategoriesResponse } from "@/contracts/catalog";
import { withErrors } from "@/lib/errors";
import { listCategories } from "@/server/catalog/categories";
import { parseQuery, respond } from "@/server/catalog/http";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (req: Request) => {
  const { locale } = parseQuery(listCategoriesQuery, req);
  return respond(listCategoriesResponse, { data: await listCategories(locale) });
});
