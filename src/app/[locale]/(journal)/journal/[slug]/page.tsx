import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { call } from "@/lib/store/data-source";
import { apiLocale } from "@/lib/store/i18n-helpers";
import { Link } from "@/i18n/navigation";
import { Img } from "@/components/ui/Img";
import { TipTapRenderer } from "@/components/journal/TipTapRenderer";
import { formatDate } from "@/components/journal/ArticleCard";
import { ProductGrid } from "@/components/store/ProductCard";
import { ErrorState } from "@/components/ui/States";
import type { TipTapNode } from "@/contracts/journal";

export const dynamic = "force-dynamic";
type Params = Promise<{ locale: string; slug: string }>;

const load = (locale: string, slug: string) => call("getArticle", { params: { slug }, query: { locale: apiLocale(locale) } });

function wordCount(nodes: TipTapNode[] | undefined): number {
  return (nodes ?? []).reduce((n, x) => n + (x.text ? x.text.split(/\s+/).length : 0) + wordCount(x.content), 0);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  const res = await load(locale, slug);
  if (!res.ok) return {};
  const a = res.data.data;
  return { title: a.seoTitle ?? a.title, description: a.seoDescription ?? a.excerpt ?? undefined, openGraph: { type: "article", publishedTime: a.publishedAt } };
}

export default async function ArticlePage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("journal");
  const s = await getTranslations("shop");
  const res = await load(locale, slug);
  if (!res.ok) {
    if (res.status === 404) notFound();
    return <div className="px-4 py-24"><ErrorState title={t("emptyTitle")} /></div>;
  }
  const a = res.data.data;
  const minutes = Math.max(1, Math.round(wordCount(a.body.content) / 220));
  const jsonLd = { "@context": "https://schema.org", "@type": "Article", headline: a.title, datePublished: a.publishedAt, author: a.authorName ? { "@type": "Person", name: a.authorName } : undefined };
  return (
    <article className="pb-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <header className="mx-auto max-w-[1440px] px-4 pt-10 md:px-8 md:pt-16">
        <Link href="/journal" className="link-underline text-xs uppercase tracking-[0.18em]">← {t("back")}</Link>
        <div className="mt-10 grid gap-8 md:grid-cols-12 md:items-end">
          <div className="md:col-span-8">
            <p className="eyebrow">
              {a.tags.map((x) => x.name).join(" · ")}{a.tags.length ? " · " : ""}
              <time dateTime={a.publishedAt}>{formatDate(a.publishedAt, locale)}</time>
            </p>
            <h1 className="mt-4 text-5xl leading-[1.02] md:text-7xl">{a.title}</h1>
          </div>
          <p className="text-sm text-muted md:col-span-4 md:justify-self-end">
            {a.authorName ? t("by", { author: a.authorName }) : null} · {t("minRead", { min: minutes })}
          </p>
        </div>
        <div className="relative mt-10 aspect-[16/9] overflow-hidden bg-line">
          <Img src={a.coverImageUrl} alt="" fill priority sizes="100vw" className="object-cover" />
        </div>
      </header>
      <div className="mx-auto mt-16 max-w-2xl px-4">
        {a.excerpt ? <p className="mb-10 font-display text-2xl leading-snug md:text-3xl">{a.excerpt}</p> : null}
        <TipTapRenderer doc={a.body} />
      </div>
      {a.products.length ? (
        <section aria-labelledby="shop-story" className="mx-auto mt-20 max-w-[1440px] border-t border-line px-4 pt-16 md:px-8">
          <h2 id="shop-story" className="mb-10 text-4xl">{t("shopTheStory")}</h2>
          <ProductGrid products={a.products} locale={locale} labels={{ soldOut: s("soldOut") }} />
        </section>
      ) : null}
    </article>
  );
}
