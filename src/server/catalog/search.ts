/** GET /search (owner: Backend & Database). Prefix full-text search ('simple' config) over products + articles, as anon. */
import "server-only";
import type { SearchResponse } from "@/contracts/catalog";
import type { Locale } from "@/contracts/common";
import { asAnon } from "../db/client";
import { productCardFrom, toCard, type ProductCardRow } from "./shared";

/** "linen dre" -> "linen:* & dre:*". Only letters/digits survive, so user input can never inject tsquery syntax. */
export function toPrefixQuery(q: string): string | null {
  const terms = q.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0).slice(0, 8);
  return terms.length ? terms.map((t) => `${t}:*`).join(" & ") : null;
}

export async function search(q: string, locale: Locale, limit: number): Promise<SearchResponse["data"]> {
  const tsq = toPrefixQuery(q);
  if (!tsq) return [];
  return asAnon(async (tx) => {
    const [products, articles] = await Promise.all([
      tx<(ProductCardRow & { rank: number })[]>`
        with m as (
          select pt.product_id, max(ts_rank(pt.search_tsv, to_tsquery('simple', ${tsq}))) as rank
            from public.product_translations pt
           where pt.locale in (${locale}, 'en') and pt.search_tsv @@ to_tsquery('simple', ${tsq})
           group by pt.product_id)
        select c.*, m.rank from (${productCardFrom(tx, locale)}) c join m on m.product_id = c.id
         order by m.rank desc, c.published_at desc limit ${limit}`,
      tx<{ id: string; slug: string; title: string; excerpt: string | null; rank: number }[]>`
        with m as (
          select at.article_id, max(ts_rank(at.search_tsv, to_tsquery('simple', ${tsq}))) as rank
            from public.article_translations at
           where at.locale in (${locale}, 'en') and at.search_tsv @@ to_tsquery('simple', ${tsq})
           group by at.article_id)
        select a.id, a.slug, coalesce(t.title, te.title) as title, coalesce(t.excerpt, te.excerpt) as excerpt, m.rank
          from public.storefront_articles a join m on m.article_id = a.id
          left join public.article_translations t on t.article_id = a.id and t.locale = ${locale}
          left join public.article_translations te on te.article_id = a.id and te.locale = 'en'
         where coalesce(t.title, te.title) is not null
         order by m.rank desc, a.published_at desc limit ${limit}`,
    ]);
    const hits: { rank: number; hit: SearchResponse["data"][number] }[] = [
      ...products.map((p) => ({ rank: Number(p.rank), hit: { type: "product" as const, product: toCard(p) } })),
      ...articles.map((a) => ({ rank: Number(a.rank), hit: { type: "article" as const, article: { id: a.id, slug: a.slug, title: a.title, excerpt: a.excerpt } } })),
    ];
    // products first on ties (shop intent), stable otherwise
    return hits.sort((x, y) => y.rank - x.rank || (x.hit.type === y.hit.type ? 0 : x.hit.type === "product" ? -1 : 1)).slice(0, limit).map((h) => h.hit);
  });
}
