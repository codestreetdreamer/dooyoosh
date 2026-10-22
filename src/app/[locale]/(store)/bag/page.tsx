import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BagView } from "@/components/store/BagView";

export const metadata: Metadata = { title: "Shopping bag", robots: { index: false } };

export default async function BagPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("bag");
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 md:px-8 md:py-14">
      <h1 className="mb-10 text-5xl md:text-6xl">{t("title")}</h1>
      <BagView />
    </div>
  );
}
