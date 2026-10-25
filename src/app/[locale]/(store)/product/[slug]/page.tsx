import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { call } from "@/lib/store/data-source";
import { exponentOf } from "@/lib/money";
import { apiLocale } from "@/lib/store/i18n-helpers";
import { Link } from "@/i18n/navigation";
import { ProductGallery } from "@/components/store/ProductGallery";
import { ProductPurchase } from "@/components/store/ProductPurchase";
import { ProductGrid } from "@/components/store/ProductCard";
import { ErrorState } from "@/components/ui/States";

export const dynamic = "force-dynamic";
type Params = Promise<{ locale: string; slug: string }>;

async function load(locale: string, slug: string) {
  return call("getProduct", { params: { slug }, query: { locale: apiLocale(locale) } });
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  const res = await load(locale, slug);
  if (!res.ok) return {};
  const p = res.data.data;
  return {
    title: p.seoTitle ?? p.name,
    description: p.seoDescription ?? p.description ?? undefined,
    openGraph: { images: p.image && !p.image.url.endsWith(".svg") ? [p.image.url] : undefined },
  };
}

export default async function ProductPage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("product");
  const nav = await getTranslations("nav");
  const s = await getTranslations("shop");
  const res = await load(locale, slug);
  if (!res.ok) {
    if (res.status === 404) notFound();
    return (
      <div className="px-4 py-24">
        <ErrorState title={s("errorTitle")}>{s("errorBody")}</ErrorState>
      </div>
    );
  }
  const p = res.data.data;
  const related = await call("listProducts", { query: { locale: apiLocale(locale), category: p.categorySlug, limit: 5 } });
  const relatedProducts = related.ok ? related.data.data.filter((x) => x.id !== p.id).slice(0, 4) : [];
  const catKey = (["clothing", "footwear", "accessories"] as const).find((c) => c === p.categorySlug);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.description ?? undefined,
    sku: p.variants[0]?.sku,
    brand: { "@type": "Brand", name: p.brand ?? "Dooyoosh" },
    offers: p.variants.map((v) => ({
      "@type": "Offer",
      sku: v.sku,
      priceCurrency: v.currency,
      price: (v.priceMinor / 10 ** exponentOf(v.currency)).toFixed(exponentOf(v.currency)),
      availability: v.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    })),
  };

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-10 pt-6 md:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <nav aria-label={t("breadcrumb")} className="mb-6 text-xs uppercase tracking-[0.14em] text-muted">
        <ol className="flex flex-wrap gap-2">
          <li><Link href="/shop" className="link-underline">{nav("shop")}</Link> /</li>
          {catKey ? <li><Link href={`/shop/${catKey}`} className="link-underline">{nav(catKey)}</Link> /</li> : null}
          <li aria-current="page" className="text-ink">{p.name}</li>
        </ol>
      </nav>
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-7">
          <ProductGallery images={p.images} name={p.name} labels={{ gallery: t("gallery"), showImage: t("showImage", { n: "{n}" }) }} />
        </div>
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-28">
            <ProductPurchase product={p} locale={locale} />
            <div className="mt-12 divide-y divide-line border-y border-line">
              {[
                [t("description"), p.description],
                [t("materials"), p.materials],
                [t("care"), p.care],
                [t("fit"), p.fitNotes],
              ].filter(([, v]) => v).map(([label, value], i) => (
                <details key={label} open={i === 0} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-xs uppercase tracking-[0.18em]">
                    {label}
                    <span aria-hidden className="text-lg transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-4 leading-relaxed text-muted">{value}</p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </div>
      {relatedProducts.length ? (
        <section aria-labelledby="related" className="mt-24">
          <h2 id="related" className="mb-10 text-4xl">{t("related")}</h2>
          <ProductGrid products={relatedProducts} locale={locale} labels={{ soldOut: s("soldOut") }} />
        </section>
      ) : null}
    </div>
  );
}
