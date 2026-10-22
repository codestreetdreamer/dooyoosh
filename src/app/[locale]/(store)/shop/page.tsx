import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ShopListing, type ShopSearchParams } from "@/components/store/ShopListing";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "shop" });
  return { title: t("title") };
}

export default async function ShopPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<ShopSearchParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("shop");
  return <ShopListing locale={locale} searchParams={await searchParams} title={t("title")} />;
}
