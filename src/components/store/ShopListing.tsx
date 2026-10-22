import { getTranslations } from "next-intl/server";
import { toMinor } from "@/lib/money";
import { call } from "@/lib/store/data-source";
import { apiLocale } from "@/lib/store/i18n-helpers";
import { Link } from "@/i18n/navigation";
import { PRODUCT_SORTS } from "@/contracts/catalog";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { ProductGrid } from "./ProductCard";
import { ShopFilters } from "./ShopFilters";

export type ShopSearchParams = { [k: string]: string | string[] | undefined };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/** Facet values until the API exposes facets (requested from Backend). */
const SIZE_OPTIONS = ["XS", "S", "M", "L", "34", "36", "37", "38", "39", "40", "41"];
const COLOUR_OPTIONS = ["Ivory", "Taupe", "Dusty Rose", "Blush", "Camel", "Espresso", "Gold"];

function majorToMinor(v: string | undefined, currency: string | undefined): number | undefined {
  if (!v || !currency) return undefined;
  try {
    const n = toMinor(v.replace(/[\s,]/g, ""), currency);
    return n >= 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

export async function ShopListing({ locale, category, searchParams, title, intro }: {
  locale: string; category?: string; searchParams: ShopSearchParams; title: string; intro?: string | null;
}) {
  const t = await getTranslations("shop");
  const nav = await getTranslations("nav");
  const l = apiLocale(locale);

  const sortParam = first(searchParams.sort);
  const sort = (PRODUCT_SORTS as readonly string[]).includes(sortParam ?? "") ? (sortParam as (typeof PRODUCT_SORTS)[number]) : "new";
  const size = first(searchParams.size);
  const colour = first(searchParams.colour);
  const minMajor = first(searchParams.min);
  const maxMajor = first(searchParams.max);
  const cursor = first(searchParams.cursor);

  // Currency comes from the catalog itself (never hardcoded) — used to convert the price filter to minor units.
  const probe = await call("listProducts", { query: { locale: l, limit: 1 } });
  const currency = probe.ok ? probe.data.data[0]?.currency : undefined;

  const res = await call("listProducts", {
    query: {
      locale: l, category, size, colour, sort, cursor, limit: 24,
      minPrice: majorToMinor(minMajor, currency),
      maxPrice: majorToMinor(maxMajor, currency),
    },
  });

  const labels = { soldOut: t("soldOut") };
  const nextCursor = res.ok ? res.data.page.cursor : null;
  const nextHref = (() => {
    if (!nextCursor) return null;
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ sort, size, colour, min: minMajor, max: maxMajor, cursor: nextCursor })) if (v) sp.set(k, v);
    return `${category ? `/shop/${category}` : "/shop"}?${sp.toString()}`;
  })();

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-10 pt-10 md:px-8 md:pt-14">
      <nav aria-label={t("category")} className="mb-6">
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-xs uppercase tracking-[0.18em]">
          {[["/shop", nav("shop"), !category], ["/shop/clothing", nav("clothing"), category === "clothing"], ["/shop/footwear", nav("footwear"), category === "footwear"], ["/shop/accessories", nav("accessories"), category === "accessories"]].map(([href, label, active]) => (
            <li key={String(href)}>
              <Link href={String(href)} aria-current={active ? "page" : undefined} className={`link-underline ${active ? "border-b border-ink" : "text-muted"}`}>{String(label)}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <header className="mb-10 grid gap-4 md:grid-cols-12 md:items-end">
        <h1 className="text-5xl md:col-span-7 md:text-7xl">{title}</h1>
        {intro ? <p className="max-w-md text-muted md:col-span-5 md:justify-self-end">{intro}</p> : null}
      </header>

      <ShopFilters
        action={category ? `/${locale}/shop/${category}` : `/${locale}/shop`}
        values={{ sort, size: size ?? "", colour: colour ?? "", min: minMajor ?? "", max: maxMajor ?? "" }}
        sizes={SIZE_OPTIONS}
        colours={COLOUR_OPTIONS}
        currency={currency ?? ""}
        labels={{
          filters: t("filters"), size: t("size"), anySize: t("anySize"), colour: t("colour"), anyColour: t("anyColour"),
          minPrice: t("minPrice"), maxPrice: t("maxPrice"), sort: t("sort"), sortNew: t("sortNew"),
          sortPriceAsc: t("sortPriceAsc"), sortPriceDesc: t("sortPriceDesc"), apply: t("apply"), reset: t("reset"),
          results: res.ok ? t("results", { count: res.data.data.length }) : "",
        }}
      />

      <div className="mt-10">
        {!res.ok ? (
          <ErrorState title={t("errorTitle")}>{t("errorBody")}</ErrorState>
        ) : res.data.data.length === 0 ? (
          <EmptyState title={t("emptyTitle")} action={<Link href="/shop" className="btn btn-outline">{t("reset")}</Link>}>
            {t("emptyBody")}
          </EmptyState>
        ) : (
          <>
            <ProductGrid products={res.data.data} locale={locale} labels={labels} priorityCount={4} />
            {nextHref ? (
              <div className="mt-14 text-center">
                <Link href={nextHref} className="btn btn-outline">{t("loadMore")}</Link>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
