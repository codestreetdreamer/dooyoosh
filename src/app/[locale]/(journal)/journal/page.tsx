import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { call } from "@/lib/store/data-source";
import { apiLocale } from "@/lib/store/i18n-helpers";
import { ArticleCard } from "@/components/journal/ArticleCard";
import { EmptyState, ErrorState } from "@/components/ui/States";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "journal" });
  return { title: t("title"), description: t("intro") };
}

export default async function JournalIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("journal");
  const res = await call("listArticles", { query: { locale: apiLocale(locale), limit: 24 } });
  const [lead, ...rest] = res.ok ? res.data.data : [];
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 md:px-8 md:py-14">
      <header className="mb-14 grid gap-4 md:grid-cols-12 md:items-end">
        <h1 className="text-6xl md:col-span-7 md:text-8xl">{t("title")}</h1>
        <p className="max-w-sm text-lg text-muted md:col-span-5 md:justify-self-end">{t("intro")}</p>
      </header>
      {!res.ok ? (
        <ErrorState title={t("emptyTitle")} />
      ) : !lead ? (
        <EmptyState title={t("emptyTitle")} />
      ) : (
        <>
          <ArticleCard article={lead} locale={locale} readMore={t("readMore")} large />
          {rest.length ? (
            <ul className="mt-20 grid gap-14 md:grid-cols-2 lg:grid-cols-3">
              {rest.map((a) => (
                <li key={a.id}><ArticleCard article={a} locale={locale} readMore={t("readMore")} /></li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
