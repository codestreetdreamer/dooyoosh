import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { OrderView } from "@/components/store/OrderView";

export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ locale: string; reference: string }> }) {
  const { locale, reference } = await params;
  setRequestLocale(locale);
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 md:py-24">
      {/* token is read client-side from ?token= or sessionStorage, then stripped from the URL */}
      <OrderView reference={decodeURIComponent(reference)} />
    </div>
  );
}
