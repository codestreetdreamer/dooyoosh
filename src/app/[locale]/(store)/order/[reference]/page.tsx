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
      {/* access token: sessionStorage (from checkout) or an email link #token= fragment, stripped immediately; sent only as Bearer */}
      <OrderView reference={decodeURIComponent(reference)} />
    </div>
  );
}
