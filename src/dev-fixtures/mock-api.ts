/**
 * DEV-ONLY MOCK of the /api/v1 contract — NOT PRODUCTION. Activated only by src/lib/store/data-source.ts
 * when NEXT_PUBLIC_USE_FIXTURES=true (and never on a Vercel production deployment).
 * Mirrors the real behaviour the UI depends on: server-side price recompute, 409 OUT_OF_STOCK / PRICE_CHANGED
 * with details.variantIds, and a simulated hosted payment page (/[locale]/dev/mock-pay).
 */
import type { ApiResult, RequestArgs, ResponseOf } from "@/lib/api-client";
import type { EndpointName } from "@/contracts";
import { MAX_LINE_QTY } from "@/contracts/cart";
import { fixtureCategories, fixtureProducts, toCard } from "./catalog";
import { fixtureArticles } from "./journal";

type Any = Record<string, unknown>;
const ok = <N extends EndpointName>(data: unknown, status = 200): ApiResult<N> => ({ ok: true, status, data: data as ResponseOf<N> });
const fail = <N extends EndpointName>(status: number, code: string, message: string, details: Any = {}): ApiResult<N> =>
  ({ ok: false, status, error: { code, message, details } }) as ApiResult<N>;

const allVariants = () => fixtureProducts.flatMap((p) => p.variants.map((v) => ({ product: p, variant: v })));
const SHIPPING = {
  UZ: [
    { methodId: "00000000-0000-4000-b000-000000000001", code: "uz_standard", name: "Standard (Uzbekistan)", minDays: 1, maxDays: 3, priceMinor: 3_000_000, freeOverMinor: 300_000_000 },
    { methodId: "00000000-0000-4000-b000-000000000002", code: "uz_express", name: "Express courier, Tashkent", minDays: 0, maxDays: 1, priceMinor: 6_000_000, freeOverMinor: null },
  ],
  INTL: [{ methodId: "00000000-0000-4000-b000-000000000003", code: "intl", name: "International tracked", minDays: 5, maxDays: 12, priceMinor: 35_000_000, freeOverMinor: null }],
};
const SHIPPABLE = new Set(["UZ", "KZ", "PL", "DE", "GB", "US", "AE", "TR"]);

type MockCheckout = { status: "awaiting_payment" | "completed" | "failed" | "expired"; token: string; reference: string | null; order: Any };
const store = (): Map<string, MockCheckout> => {
  const g = globalThis as unknown as { __dyMock?: Map<string, MockCheckout> };
  g.__dyMock ??= new Map();
  return g.__dyMock;
};
const LS_KEY = "dooyoosh.mock-checkouts";
function readMock(id: string): MockCheckout | undefined {
  if (typeof window !== "undefined") {
    const all = JSON.parse(window.localStorage.getItem(LS_KEY) ?? "{}") as Record<string, MockCheckout>;
    return all[id];
  }
  return store().get(id);
}
function writeMock(id: string, c: MockCheckout) {
  if (typeof window !== "undefined") {
    const all = JSON.parse(window.localStorage.getItem(LS_KEY) ?? "{}") as Record<string, MockCheckout>;
    all[id] = c;
    window.localStorage.setItem(LS_KEY, JSON.stringify(all));
  } else store().set(id, c);
}

/** Used by the dev mock payment page to simulate the provider webhook outcome. */
export function mockSettle(checkoutId: string, outcome: "succeeded" | "failed") {
  const c = readMock(checkoutId);
  if (!c) return null;
  const next: MockCheckout = outcome === "succeeded"
    ? { ...c, status: "completed", reference: `DY-20261022-${checkoutId.replace(/[^A-Z2-7]/gi, "").toUpperCase().replace(/[^A-Z2-7]/g, "A").slice(0, 5).padEnd(5, "A")}` }
    : { ...c, status: "failed" };
  writeMock(checkoutId, next);
  return next;
}

function uuid() {
  const h = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Mirrors the real contract: guest token only via `Authorization: Bearer`. */
function bearer(a: { headers?: Record<string, string> }): string | null {
  const h = a.headers?.Authorization ?? a.headers?.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

export async function mockApi<N extends EndpointName>(name: N, args: RequestArgs<N>): Promise<ApiResult<N>> {
  const a = args as { params?: Any; query?: Any; body?: Any; baseUrl?: string; headers?: Record<string, string> };
  const q = a.query ?? {};
  switch (name) {
    case "listCategories":
      return ok({ data: fixtureCategories });
    case "listProducts": {
      let list = fixtureProducts.slice();
      if (q.category) list = list.filter((p) => p.categorySlug === q.category);
      if (q.size) list = list.filter((p) => p.variants.some((v) => v.size === q.size));
      if (q.colour) list = list.filter((p) => p.variants.some((v) => v.colour?.toLowerCase() === String(q.colour).toLowerCase()));
      if (q.minPrice !== undefined) list = list.filter((p) => p.priceFromMinor >= Number(q.minPrice));
      if (q.maxPrice !== undefined) list = list.filter((p) => p.priceFromMinor <= Number(q.maxPrice));
      const sort = (q.sort as string) ?? "new";
      list.sort((x, y) =>
        sort === "price_asc" ? x.priceFromMinor - y.priceFromMinor
        : sort === "price_desc" ? y.priceFromMinor - x.priceFromMinor
        : (y.publishedAt ?? "").localeCompare(x.publishedAt ?? ""));
      const limit = Number(q.limit ?? 24);
      const start = q.cursor ? Number(q.cursor) : 0;
      const page = list.slice(start, start + limit);
      const next = start + limit < list.length ? String(start + limit) : null;
      return ok({ data: page.map(toCard), page: { cursor: next, limit } });
    }
    case "productFacets": {
      const list = q.category ? fixtureProducts.filter((p) => p.categorySlug === q.category) : fixtureProducts;
      const inStock = list.filter((p) => p.available);
      const sizes = new Map<string, { count: number; sizeSystem: string }>();
      const colours = new Map<string, { count: number; hex: string | null }>();
      for (const p of inStock) {
        const av = p.variants.filter((v) => v.available);
        for (const sz of new Set(av.map((v) => v.size).filter((x): x is string => !!x))) sizes.set(sz, { count: (sizes.get(sz)?.count ?? 0) + 1, sizeSystem: p.sizeSystem });
        for (const c of new Set(av.map((v) => v.colour).filter((x): x is string => !!x))) colours.set(c, { count: (colours.get(c)?.count ?? 0) + 1, hex: av.find((v) => v.colour === c)?.colourHex ?? null });
      }
      const prices = inStock.map((p) => p.priceFromMinor);
      return ok({
        data: {
          sizes: [...sizes].map(([value, v]) => ({ value, label: value, count: v.count, sizeSystem: v.sizeSystem })),
          colours: [...colours].map(([value, v]) => ({ value, label: value, count: v.count, hex: v.hex })),
          priceMinor: prices.length ? { min: Math.min(...prices), max: Math.max(...prices), currency: inStock[0]!.currency } : null,
        },
      });
    }
    case "getProduct": {
      const p = fixtureProducts.find((x) => x.slug === a.params?.slug);
      return p ? ok({ data: p }) : fail(404, "NOT_FOUND", "Product not found");
    }
    case "validateCart": {
      const items = (a.body?.items ?? []) as { variantId: string; quantity: number }[];
      const all = allVariants();
      let currency = "UZS";
      const lines = items.map((it) => {
        const hit = all.find((x) => x.variant.id === it.variantId);
        if (!hit) {
          return { variantId: it.variantId, productSlug: "", productName: "Unavailable item", sku: "", size: null, colour: null, imageUrl: null,
            unitPriceMinor: 0, quantity: 0, lineTotalMinor: 0, available: false, lowStock: false, issue: "not_found" as const };
        }
        currency = hit.variant.currency;
        const available = hit.variant.available;
        const qty = available ? Math.min(it.quantity, MAX_LINE_QTY) : 0;
        return {
          variantId: it.variantId, productSlug: hit.product.slug, productName: hit.product.name, sku: hit.variant.sku,
          size: hit.variant.size, colour: hit.variant.colour, imageUrl: hit.product.image?.url ?? null,
          unitPriceMinor: hit.variant.priceMinor, quantity: qty, lineTotalMinor: hit.variant.priceMinor * qty,
          available, lowStock: false, issue: available ? null : ("out_of_stock" as const),
        };
      });
      return ok({ data: { currency, lines, subtotalMinor: lines.reduce((s, l) => s + l.lineTotalMinor, 0), allAvailable: lines.every((l) => l.available) } });
    }
    case "shippingOptions": {
      const c = String(q.country ?? "").toUpperCase();
      if (!SHIPPABLE.has(c)) return fail(422, "COUNTRY_NOT_SHIPPABLE", "We do not ship to this country yet", { country: c });
      const opts = (c === "UZ" ? SHIPPING.UZ : SHIPPING.INTL).map((o) => ({ ...o, currency: "UZS" }));
      return ok({ data: { country: c, currency: "UZS", options: opts } });
    }
    case "createCheckout": {
      const b = a.body as { items: { variantId: string; quantity: number; expectedUnitPriceMinor?: number }[]; shippingMethodId: string; shippingAddress: { country: string }; locale: string; email: string };
      const all = allVariants();
      const oos = b.items.filter((i) => !all.find((x) => x.variant.id === i.variantId)?.variant.available).map((i) => i.variantId);
      if (oos.length) return fail(409, "OUT_OF_STOCK", "Some items are no longer available", { variantIds: oos });
      const changed = b.items.filter((i) => {
        const v = all.find((x) => x.variant.id === i.variantId)!.variant;
        return i.expectedUnitPriceMinor !== undefined && i.expectedUnitPriceMinor !== v.priceMinor;
      }).map((i) => i.variantId);
      if (changed.length) return fail(409, "PRICE_CHANGED", "Prices have changed, please review your bag", { variantIds: changed });
      const method = [...SHIPPING.UZ, ...SHIPPING.INTL].find((m) => m.methodId === b.shippingMethodId);
      if (!method) return fail(400, "VALIDATION_ERROR", "Unknown shipping method");
      const subtotal = b.items.reduce((s, i) => s + all.find((x) => x.variant.id === i.variantId)!.variant.priceMinor * i.quantity, 0);
      const shippingMinor = method.freeOverMinor !== null && subtotal >= method.freeOverMinor ? 0 : method.priceMinor;
      const totals = { currency: "UZS", subtotalMinor: subtotal, shippingMinor, taxMinor: 0, discountMinor: 0, totalMinor: subtotal + shippingMinor };
      const checkoutId = uuid();
      const token = (uuid() + uuid()).replace(/-/g, "");
      const items = b.items.map((i) => {
        const x = all.find((y) => y.variant.id === i.variantId)!;
        return { sku: x.variant.sku, productName: x.product.name, size: x.variant.size, colour: x.variant.colour, unitPriceMinor: x.variant.priceMinor, quantity: i.quantity, lineTotalMinor: x.variant.priceMinor * i.quantity };
      });
      writeMock(checkoutId, { status: "awaiting_payment", token, reference: null, order: { email: b.email, locale: b.locale, currency: "UZS", totals, items, shippingAddress: b.shippingAddress } });
      const origin = typeof window !== "undefined" ? window.location.origin : (a.baseUrl ?? "http://localhost:3000");
      const now = Date.now();
      return ok({
        data: {
          checkoutId, provider: "mock", accessToken: token,
          redirectUrl: `${origin}/${b.locale}/dev/mock-pay?checkoutId=${checkoutId}`,
          expiresAt: new Date(now + 30 * 60_000).toISOString(), reservedUntil: new Date(now + 35 * 60_000).toISOString(), totals,
        },
      }, 201);
    }
    case "checkoutStatus": {
      const c = readMock(String(a.params?.checkoutId));
      if (!c || c.token !== bearer(a)) return fail(404, "NOT_FOUND", "Not found");
      return ok({ data: { checkoutStatus: c.status, orderReference: c.reference, orderStatus: c.status === "completed" ? "paid" : null } });
    }
    case "sandboxPay": {
      const c = readMock(String(a.params?.checkoutId));
      const body = (a.body ?? {}) as { token?: string; outcome?: string };
      if (!c || c.token !== body.token) return fail(404, "NOT_FOUND", "Not found");
      mockSettle(String(a.params?.checkoutId), body.outcome === "fail" ? "failed" : "succeeded");
      return ok({ data: { callbacks: [{ status: 200, body: { mock: true } }] } });
    }
    case "getOrder": {
      if (typeof window === "undefined") return fail(404, "NOT_FOUND", "Not found");
      const all = JSON.parse(window.localStorage.getItem(LS_KEY) ?? "{}") as Record<string, MockCheckout>;
      const c = Object.values(all).find((x) => x.reference === a.params?.reference && x.token === bearer(a));
      if (!c) return fail(404, "NOT_FOUND", "Not found");
      return ok({ data: { reference: c.reference, status: "paid", ...c.order, shipments: [], placedAt: new Date().toISOString(), paidAt: new Date().toISOString() } });
    }
    case "listArticles":
      return ok({ data: fixtureArticles.map((x) => ({ id: x.id, slug: x.slug, title: x.title, excerpt: x.excerpt, coverImageUrl: x.coverImageUrl, authorName: x.authorName, publishedAt: x.publishedAt, tags: x.tags })), page: { cursor: null, limit: 24 } });
    case "getArticle": {
      const art = fixtureArticles.find((x) => x.slug === a.params?.slug);
      return art ? ok({ data: art }) : fail(404, "NOT_FOUND", "Article not found");
    }
    case "search": {
      const q = String(a.query?.q ?? "").toLowerCase();
      const prods = fixtureProducts.filter((p) => p.name.toLowerCase().includes(q)).map((p) => ({ type: "product" as const, product: toCard(p) }));
      const arts = fixtureArticles.filter((x) => x.title.toLowerCase().includes(q)).map((x) => ({ type: "article" as const, article: { id: x.id, slug: x.slug, title: x.title, excerpt: x.excerpt } }));
      return ok({ data: [...prods, ...arts] });
    }
    case "newsletterConfirm":
      return ok({ data: { status: "confirmed" } });
    case "newsletterSignup":
      return ok({ data: { status: "pending_confirmation" } }, 202);
    default:
      return fail(404, "NOT_FOUND", `mock: ${String(name)} not implemented`);
  }
}
