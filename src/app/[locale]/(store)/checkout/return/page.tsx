import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CheckoutReturn } from "@/components/store/CheckoutReturn";

export const metadata: Metadata = { title: "Order status", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type SP = Promise<{ checkoutId?: string | string[]; token?: string | string[] }>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function CheckoutReturnPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: SP }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("order");
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 md:py-24">
      <p className="eyebrow">{t("returnTitle")}</p>
      <div className="mt-6">
        <CheckoutReturn checkoutId={one(sp.checkoutId)} token={one(sp.token)} />
      </div>
    </div>
  );
}
