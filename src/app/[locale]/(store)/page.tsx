import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { call } from "@/lib/store/data-source";
import { apiLocale } from "@/lib/store/i18n-helpers";
import { Img } from "@/components/ui/Img";
import { ProductCard, ProductGrid } from "@/components/store/ProductCard";
import { ArticleCard } from "@/components/journal/ArticleCard";
import { ErrorState } from "@/components/ui/States";

export const dynamic = "force-dynamic";

const CATEGORY_TILES = [
  { slug: "clothing", img: "/placeholders/coat-2.svg" },
  { slug: "footwear", img: "/placeholders/boot-4.svg" },
  { slug: "accessories", img: "/placeholders/bag-1.svg" },
] as const;

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const nav = await getTranslations("nav");
  const s = await getTranslations("shop");
  const j = await getTranslations("journal");
  const l = apiLocale(locale);

  const [newest, articles] = await Promise.all([
    call("listProducts", { query: { locale: l, sort: "new", limit: 8 } }),
    call("listArticles", { query: { locale: l, limit: 3 } }),
  ]);
  const products = newest.ok ? newest.data.data : [];
  const featured = products.filter((p) => p.available).slice(0, 3);
  const arrivals = products.slice(0, 4);
  const stories = articles.ok ? articles.data.data : [];
  const labels = { soldOut: s("soldOut") };

  return (
    <>
      {/* Campaign hero — asymmetric editorial split */}
      <section className="mx-auto grid max-w-[1440px] gap-8 px-4 pb-16 pt-8 md:grid-cols-12 md:px-8 md:pt-12">
        <div className="relative aspect-[4/5] overflow-hidden bg-line md:col-span-7 md:aspect-[5/6]">
          <Img src="/placeholders/dress-3.svg" alt="Campaign image placeholder: silk slip dress in dusty rose" fill priority sizes="(min-width: 768px) 58vw, 100vw" className="object-cover" />
        </div>
        <div className="flex flex-col justify-end md:col-span-5 md:pb-12 md:pl-6">
          <p className="eyebrow">{t("heroEyebrow")}</p>
          <h1 className="mt-4 text-5xl leading-[1.02] md:text-7xl">{t("heroTitle")}</h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-muted">{t("heroBody")}</p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link href="/shop" className="btn btn-primary">{t("heroCta")}</Link>
            <Link href="/journal" className="btn btn-outline">{t("heroSecondary")}</Link>
          </div>
        </div>
      </section>

      {/* Featured — offset editorial trio */}
      {featured.length ? (
        <section aria-labelledby="featured" className="mx-auto max-w-[1440px] px-4 py-16 md:px-8">
          <div className="mb-10 flex items-end justify-between">
            <h2 id="featured" className="text-4xl md:text-5xl">{t("featured")}</h2>
            <Link href="/shop" className="link-underline text-xs uppercase tracking-[0.18em]">{t("viewAll")}</Link>
          </div>
          <ul className="grid gap-x-6 gap-y-12 md:grid-cols-3">
            {featured.map((p, i) => (
              <li key={p.id} className={i === 1 ? "md:mt-24" : i === 2 ? "md:mt-10" : ""}>
                <ProductCard product={p} locale={locale} labels={labels} sizes="(min-width: 768px) 33vw, 100vw" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Categories */}
      <section aria-labelledby="categories" className="mx-auto max-w-[1440px] px-4 py-16 md:px-8">
        <h2 id="categories" className="mb-10 text-4xl md:text-5xl">{t("categories")}</h2>
        <ul className="grid gap-6 md:grid-cols-3">
          {CATEGORY_TILES.map((c) => (
            <li key={c.slug}>
              <Link href={`/shop/${c.slug}`} className="group relative block aspect-[3/4] overflow-hidden bg-line">
                <Img src={c.img} alt="" fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/60 to-transparent p-6 font-display text-3xl text-bg">{nav(c.slug)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* New arrivals */}
      <section aria-labelledby="new-arrivals" className="mx-auto max-w-[1440px] px-4 py-16 md:px-8">
        <div className="mb-10 flex items-end justify-between">
          <h2 id="new-arrivals" className="text-4xl md:text-5xl">{t("newArrivals")}</h2>
          <Link href="/shop?sort=new" className="link-underline text-xs uppercase tracking-[0.18em]">{t("viewAll")}</Link>
        </div>
        {newest.ok ? (
          <ProductGrid products={arrivals} locale={locale} labels={labels} />
        ) : (
          <ErrorState title={s("errorTitle")}>{s("errorBody")}</ErrorState>
        )}
      </section>

      {/* Journal highlights */}
      {stories.length ? (
        <section aria-labelledby="journal-highlights" className="border-t border-line">
          <div className="mx-auto max-w-[1440px] px-4 py-20 md:px-8">
            <div className="mb-10 flex items-end justify-between">
              <h2 id="journal-highlights" className="text-4xl md:text-5xl">{t("journal")}</h2>
              <Link href="/journal" className="link-underline text-xs uppercase tracking-[0.18em]">{t("journalCta")}</Link>
            </div>
            <div className="grid gap-12 md:grid-cols-12">
              {stories[0] ? (
                <div className="md:col-span-7">
                  <ArticleCard article={stories[0]} locale={locale} readMore={j("readMore")} large />
                </div>
              ) : null}
              <div className="grid gap-12 md:col-span-5">
                {stories.slice(1, 3).map((a) => (
                  <ArticleCard key={a.id} article={a} locale={locale} readMore={j("readMore")} />
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
