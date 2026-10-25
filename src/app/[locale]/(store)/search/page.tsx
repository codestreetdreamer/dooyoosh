import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { call } from "@/lib/store/data-source";
import { apiLocale } from "@/lib/store/i18n-helpers";
import { Link } from "@/i18n/navigation";
import { ProductGrid } from "@/components/store/ProductCard";
import { EmptyState, ErrorState } from "@/components/ui/States";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "search" });
  return { title: t("title"), robots: { index: false } };
}

export default async function SearchPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("search");
  const s = await getTranslations("shop");
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 100) ?? "";
  const res = q.length >= 2 ? await call("search", { query: { q, locale: apiLocale(locale), limit: 40 } }) : null;
  const hits = res?.ok ? res.data.data : [];
  const products = hits.flatMap((h) => (h.type === "product" ? [h.product] : []));
  const articles = hits.flatMap((h) => (h.type === "article" ? [h.article] : []));
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 md:px-8 md:py-14">
      <h1 className="text-5xl md:text-7xl">{t("title")}</h1>
      <form role="search" action="" method="get" className="mt-8 flex max-w-xl gap-3">
        <label htmlFor="search-q" className="sr-only">{t("label")}</label>
        <input id="search-q" name="q" type="search" defaultValue={q} minLength={2} maxLength={100} required className="field flex-1" placeholder={t("placeholder")} autoComplete="off" />
        <button type="submit" className="btn btn-primary">{t("submit")}</button>
      </form>
      <div className="mt-12" aria-live="polite">
        {!q ? null : q.length < 2 ? (
          <p className="text-muted">{t("tooShort")}</p>
        ) : res && !res.ok ? (
          <ErrorState title={t("errorTitle")} />
        ) : !hits.length ? (
          <EmptyState title={t("noResults", { q })} />
        ) : (
          <>
            <p className="mb-8 text-sm text-muted">{t("count", { count: hits.length, q })}</p>
            {products.length ? (
              <section aria-labelledby="sr-products">
                <h2 id="sr-products" className="eyebrow !font-sans mb-6">{t("products")}</h2>
                <ProductGrid products={products} locale={locale} labels={{ soldOut: s("soldOut") }} />
              </section>
            ) : null}
            {articles.length ? (
              <section aria-labelledby="sr-articles" className="mt-16">
                <h2 id="sr-articles" className="eyebrow !font-sans mb-6">{t("articles")}</h2>
                <ul className="divide-y divide-line border-y border-line">
                  {articles.map((a) => (
                    <li key={a.id} className="py-5">
                      <Link href={`/journal/${a.slug}`} className="link-underline font-display text-2xl">{a.title}</Link>
                      {a.excerpt ? <p className="mt-2 max-w-2xl text-muted">{a.excerpt}</p> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
