import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { usingFixtures } from "@/lib/store/data-source";

export const metadata: Metadata = { title: "Mock payment (dev only)", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/** DEV ONLY — simulated hosted payment page for the fixture layer. 404 unless fixtures are enabled. */
export default async function MockPayPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ checkoutId?: string }> }) {
  if (!usingFixtures()) notFound();
  const { MockPay } = await import("@/dev-fixtures/MockPay");
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-lg px-4 py-20">
      <p className="eyebrow">Development only — not a real payment</p>
      <h1 className="mt-4 text-4xl">Mock payment provider</h1>
      <p className="mt-4 text-muted">This page stands in for Payme/Click in fixture mode. Choose an outcome to simulate the provider callback.</p>
      <MockPay checkoutId={sp.checkoutId ?? ""} locale={locale} />
    </div>
  );
}
