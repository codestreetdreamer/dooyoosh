import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CATEGORY_KINDS } from "@/contracts/catalog";
import { call } from "@/lib/store/data-source";
import { apiLocale } from "@/lib/store/i18n-helpers";
import { ShopListing, type ShopSearchParams } from "@/components/store/ShopListing";

export const dynamic = "force-dynamic";
type Params = Promise<{ locale: string; category: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, category } = await params;
  if (!(CATEGORY_KINDS as readonly string[]).includes(category)) return {};
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t(category as (typeof CATEGORY_KINDS)[number]) };
}

export default async function CategoryPage({ params, searchParams }: { params: Params; searchParams: Promise<ShopSearchParams> }) {
  const { locale, category } = await params;
  if (!(CATEGORY_KINDS as readonly string[]).includes(category)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("nav");
  const cats = await call("listCategories", { query: { locale: apiLocale(locale) } });
  const node = cats.ok ? cats.data.data.find((c) => c.slug === category) : undefined;
  return (
    <ShopListing
      locale={locale}
      category={category}
      searchParams={await searchParams}
      title={node?.name ?? t(category as (typeof CATEGORY_KINDS)[number])}
      intro={node?.description}
    />
  );
}
