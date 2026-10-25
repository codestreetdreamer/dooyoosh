/** GET /api/v1/search?q= (catalog.searchQuery -> catalog.searchResponse). Owner: Backend & Database. */
import { searchQuery, searchResponse } from "@/contracts/catalog";
import { withErrors } from "@/lib/errors";
import { parseQuery, respond } from "@/server/catalog/http";
import { search } from "@/server/catalog/search";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (req: Request) => {
  const q = parseQuery(searchQuery, req);
  return respond(searchResponse, { data: await search(q.q, q.locale, q.limit) });
});
