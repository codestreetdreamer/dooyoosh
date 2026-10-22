/** GET /api/v1/articles (journal.listArticlesQuery -> journal.listArticlesResponse). Owner: Backend & Database. */
import { listArticlesQuery, listArticlesResponse } from "@/contracts/journal";
import { withErrors } from "@/lib/errors";
import { parseQuery, respond } from "@/server/catalog/http";
import { listArticles } from "@/server/journal/articles";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (req: Request) => respond(listArticlesResponse, await listArticles(parseQuery(listArticlesQuery, req))));
