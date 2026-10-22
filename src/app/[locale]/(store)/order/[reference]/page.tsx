import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { OrderView } from "@/components/store/OrderView";

export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function OrderPage({ params, searchParams }: {
  params: Promise<{ locale: string; reference: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { locale, reference } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const token = (Array.isArray(sp.token) ? sp.token[0] : sp.token) ?? null;
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 md:py-24">
      <OrderView reference={decodeURIComponent(reference)} token={token} />
    </div>
  );
}
