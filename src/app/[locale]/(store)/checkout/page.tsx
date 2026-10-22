import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CheckoutForm } from "@/components/store/CheckoutForm";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("checkout");
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 md:px-8 md:py-14">
      <h1 className="mb-10 text-5xl md:text-6xl">{t("title")}</h1>
      <CheckoutForm />
    </div>
  );
}
