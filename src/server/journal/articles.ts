/** GET /articles, GET /articles/{slug} (owner: Backend & Database). Reads as `anon` via storefront_articles (published, published_at <= now()). */
import "server-only";
import type { ArticleCard, ArticleDetail, ListArticlesResponse } from "@/contracts/journal";
import { tiptapDoc } from "@/contracts/journal";
import type { Locale, PaginationQuery } from "@/contracts/common";
import { ApiError } from "@/lib/errors";
import { asAnon, type Tx } from "../db/client";
import { decodeCursor, encodeCursor, iso, mediaUrl, productCardFrom, toCard, type ProductCardRow } from "../catalog/shared";

type ArticleRow = { id: string; slug: string; title: string; excerpt: string | null; cover_image_path: string | null; author_name: string | null; published_at: Date; published_key: string };

function articleSelect(tx: Tx, locale: Locale) {
  return tx`
    select a.id, a.slug, coalesce(t.title, te.title) as title, case when t.title is not null then t.excerpt else te.excerpt end as excerpt,
           a.cover_image_path, a.author_name, a.published_at, a.published_at::text as published_key
      from public.storefront_articles a
      left join public.article_translations t on t.article_id = a.id and t.locale = ${locale}
      left join public.article_translations te on te.article_id = a.id and te.locale = 'en'`;
}

async function tagsFor(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; slug: string; name: string }[]>();
  const rows = await tx<{ article_id: string; id: string; slug: string; name: string }[]>`
    select at.article_id, t.id, t.slug, t.name from public.article_tags at join public.tags t on t.id = at.tag_id
     where at.article_id = any(${ids}::uuid[]) order by t.name`;
  const m = new Map<string, { id: string; slug: string; name: string }[]>();
  for (const r of rows) m.set(r.article_id, [...(m.get(r.article_id) ?? []), { id: r.id, slug: r.slug, name: r.name }]);
  return m;
}

const toArticleCard = (r: ArticleRow, tags: Map<string, { id: string; slug: string; name: string }[]>): ArticleCard => ({
  id: r.id, slug: r.slug, title: r.title, excerpt: r.excerpt, coverImageUrl: mediaUrl(r.cover_image_path),
  authorName: r.author_name, publishedAt: iso(r.published_at)!, tags: tags.get(r.id) ?? [],
});

export async function listArticles(q: PaginationQuery & { tag?: string; locale: Locale }): Promise<ListArticlesResponse> {
  return asAnon(async (tx) => {
    let after = tx``;
    if (q.cursor) {
      const [ts, id] = decodeCursor(q.cursor, ["string", "string"]) as [string, string];
      if (Number.isNaN(Date.parse(ts))) throw ApiError.validation("Invalid cursor");
      after = tx`and (a.published_at, a.id) < (${ts}::timestamptz, ${id}::uuid)`;
    }
    const tag = q.tag
      ? tx`and exists (select 1 from public.article_tags x join public.tags tg on tg.id = x.tag_id where x.article_id = a.id and tg.slug = ${q.tag})`
      : tx``;
    const rows = await tx<ArticleRow[]>`
      ${articleSelect(tx, q.locale)}
      where coalesce(t.title, te.title) is not null ${tag} ${after}
      order by a.published_at desc, a.id desc limit ${q.limit + 1}`;
    const page = rows.slice(0, q.limit);
    const tags = await tagsFor(tx, page.map((r) => r.id));
    const last = page.at(-1);
    return {
      data: page.map((r) => toArticleCard(r, tags)),
      page: { cursor: rows.length > q.limit && last ? encodeCursor([last.published_key, last.id]) : null, limit: q.limit },
    };
  });
}

export async function getArticle(slug: string, locale: Locale): Promise<ArticleDetail> {
  return asAnon(async (tx) => {
    const [row] = await tx<(ArticleRow & { body: unknown; seo_title: string | null; seo_description: string | null })[]>`
      select x.*, coalesce(t2.body, te2.body) as body,
             case when t2.title is not null then t2.seo_title else te2.seo_title end as seo_title,
             case when t2.title is not null then t2.seo_description else te2.seo_description end as seo_description
        from (${articleSelect(tx, locale)} where a.slug = ${slug}) x
        left join public.article_translations t2 on t2.article_id = x.id and t2.locale = ${locale}
        left join public.article_translations te2 on te2.article_id = x.id and te2.locale = 'en'
       where x.title is not null`;
    if (!row) throw ApiError.notFound("Article not found");
    const [tags, products] = await Promise.all([
      tagsFor(tx, [row.id]),
      tx<ProductCardRow[]>`
        select c.* from (${productCardFrom(tx, locale)}) c
          join public.article_products ap on ap.product_id = c.id and ap.article_id = ${row.id}
         order by ap.sort_order, c.slug`,
    ]);
    const body = tiptapDoc.safeParse(row.body);
    return {
      ...toArticleCard(row, tags),
      body: body.success ? body.data : { type: "doc", content: [] },
      seoTitle: row.seo_title, seoDescription: row.seo_description,
      products: products.map(toCard),
    };
  });
}
