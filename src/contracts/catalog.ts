/** Catalog contracts: GET /products, /products/{slug}, /categories, /search (spec §5 Public). Owner: Backend & Database. */
import { z } from "zod";
import { currency, isoDateTime, locale, nonNegativeMinor, paginated, paginationQuery, single, slug, uuid } from "./common";

export const CATEGORY_KINDS = ["clothing", "footwear", "accessories"] as const;
export const categoryKind = z.enum(CATEGORY_KINDS);
export const PRODUCT_STATUSES = ["draft", "published", "archived"] as const;
export const productStatus = z.enum(PRODUCT_STATUSES);
export const SIZE_SYSTEMS = ["alpha", "eu_shoe", "uk_shoe", "us_shoe", "one_size", "numeric"] as const;
export const sizeSystem = z.enum(SIZE_SYSTEMS);
export const PRODUCT_SORTS = ["new", "price_asc", "price_desc"] as const;

export const productImage = z.object({
  id: uuid,
  variantId: uuid.nullable(),
  url: z.url(),
  alt: z.string(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  sortOrder: z.number().int(),
});
export type ProductImage = z.infer<typeof productImage>;

/** Public variant: exact stock is hidden (spec §5), only `available`. */
export const publicVariant = z.object({
  id: uuid,
  sku: z.string(),
  size: z.string().nullable(),
  colour: z.string().nullable(),
  colourHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),
  priceMinor: nonNegativeMinor,
  currency,
  available: z.boolean(),
});
export type PublicVariant = z.infer<typeof publicVariant>;

export const productCard = z.object({
  id: uuid,
  slug,
  name: z.string(),
  brand: z.string().nullable(),
  categorySlug: slug,
  priceFromMinor: nonNegativeMinor,
  currency,
  image: productImage.nullable(),
  available: z.boolean(),
  publishedAt: isoDateTime.nullable(),
});
export type ProductCard = z.infer<typeof productCard>;

export const productDetail = productCard.extend({
  description: z.string().nullable(),
  materials: z.string().nullable(),
  care: z.string().nullable(),
  fitNotes: z.string().nullable(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  sizeSystem,
  sizeChart: z.object({ id: uuid, name: z.string(), data: z.unknown() }).nullable(),
  images: z.array(productImage),
  variants: z.array(publicVariant),
});
export type ProductDetail = z.infer<typeof productDetail>;

// GET /products
export const listProductsQuery = paginationQuery.extend({
  locale: locale.default("en"),
  category: slug.optional(),
  size: z.string().max(20).optional(),
  colour: z.string().max(40).optional(),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
  sort: z.enum(PRODUCT_SORTS).default("new"),
});
export type ListProductsQuery = z.infer<typeof listProductsQuery>;
export const listProductsResponse = paginated(productCard);
export type ListProductsResponse = z.infer<typeof listProductsResponse>;

// GET /products/{slug}
export const productParams = z.object({ slug });
export const getProductQuery = z.object({ locale: locale.default("en") });
export const getProductResponse = single(productDetail);
export type GetProductResponse = z.infer<typeof getProductResponse>;

// GET /categories
export type CategoryNode = {
  id: string;
  slug: string;
  kind: z.infer<typeof categoryKind>;
  name: string;
  description: string | null;
  sortOrder: number;
  children: CategoryNode[];
};
export const categoryNode: z.ZodType<CategoryNode> = z.lazy(() =>
  z.object({
    id: uuid,
    slug,
    kind: categoryKind,
    name: z.string(),
    description: z.string().nullable(),
    sortOrder: z.number().int(),
    children: z.array(categoryNode),
  }),
);
export const listCategoriesQuery = z.object({ locale: locale.default("en") });
export const listCategoriesResponse = z.object({ data: z.array(categoryNode) });
export type ListCategoriesResponse = z.infer<typeof listCategoriesResponse>;

// GET /search?q=
export const searchQuery = z.object({
  q: z.string().trim().min(2).max(100),
  locale: locale.default("en"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const searchHit = z.discriminatedUnion("type", [
  z.object({ type: z.literal("product"), product: productCard }),
  z.object({
    type: z.literal("article"),
    article: z.object({ id: uuid, slug, title: z.string(), excerpt: z.string().nullable() }),
  }),
]);
export const searchResponse = z.object({ data: z.array(searchHit) });
export type SearchResponse = z.infer<typeof searchResponse>;
