/** Journal contracts: GET /articles, /articles/{slug} (spec §5). Owner: Backend & Database. Brief after "Journal:" is [OPEN]. */
import { z } from "zod";
import { productCard } from "./catalog";
import { isoDateTime, locale, paginated, paginationQuery, single, slug, uuid } from "./common";

export const ARTICLE_STATUSES = ["draft", "scheduled", "published", "archived"] as const;
export const articleStatus = z.enum(ARTICLE_STATUSES);

/** TipTap JSON document (stored as jsonb). Rendered server-side; never raw HTML from DB. */
export type TipTapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};
export const tiptapNode: z.ZodType<TipTapNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(tiptapNode).optional(),
    marks: z.array(z.object({ type: z.string(), attrs: z.record(z.string(), z.unknown()).optional() })).optional(),
    text: z.string().optional(),
  }),
);
export const tiptapDoc = z.object({ type: z.literal("doc"), content: z.array(tiptapNode) });

export const tag = z.object({ id: uuid, slug, name: z.string() });

export const articleCard = z.object({
  id: uuid,
  slug,
  title: z.string(),
  excerpt: z.string().nullable(),
  coverImageUrl: z.url().nullable(),
  authorName: z.string().nullable(),
  publishedAt: isoDateTime,
  tags: z.array(tag),
});
export type ArticleCard = z.infer<typeof articleCard>;

export const articleDetail = articleCard.extend({
  body: tiptapDoc,
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  /** shoppable editorial */
  products: z.array(productCard),
});
export type ArticleDetail = z.infer<typeof articleDetail>;

export const listArticlesQuery = paginationQuery.extend({ tag: slug.optional(), locale: locale.default("en") });
export const listArticlesResponse = paginated(articleCard);
export type ListArticlesResponse = z.infer<typeof listArticlesResponse>;

export const articleParams = z.object({ slug });
export const getArticleQuery = z.object({ locale: locale.default("en") });
export const getArticleResponse = single(articleDetail);
export type GetArticleResponse = z.infer<typeof getArticleResponse>;

// ---- POST /newsletter (double opt-in). Owner: Backend & Database ----
// Always 202 with the same body whether or not the email exists (no enumeration).
export const newsletterSignupRequest = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  locale: locale.default("en"),
  /** honeypot; must be empty */
  website: z.string().max(0).optional(),
});
export const newsletterSignupResponse = z.object({ data: z.object({ status: z.literal("pending_confirmation") }) });
/** GET /newsletter/confirm?token= */
export const newsletterConfirmQuery = z.object({ token: z.string().min(32).max(128) });
export const newsletterConfirmResponse = z.object({ data: z.object({ status: z.literal("confirmed") }) });
