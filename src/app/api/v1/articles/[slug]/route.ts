/** GET /api/v1/articles/{slug} (journal.articleParams + getArticleQuery -> journal.getArticleResponse). Owner: Backend & Database. */
import { articleParams, getArticleQuery, getArticleResponse } from "@/contracts/journal";
import { withErrors } from "@/lib/errors";
import { parseParams, parseQuery, respond } from "@/server/catalog/http";
import { getArticle } from "@/server/journal/articles";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = parseParams(articleParams, await ctx.params);
  const { locale } = parseQuery(getArticleQuery, req);
  return respond(getArticleResponse, { data: await getArticle(slug, locale) });
});
