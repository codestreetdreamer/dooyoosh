import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { SandboxPay } from "@/components/store/SandboxPay";

export const metadata: Metadata = { title: "Sandbox payment", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/** SANDBOX ONLY — stands in for the provider's hosted page. The API behind it 404s unless the sandbox gate is open. */
export default async function SandboxPayPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ checkoutId?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { checkoutId } = await searchParams;
  return (
    <div className="mx-auto max-w-lg px-4 py-20">
      <p className="eyebrow">Sandbox — no real payment</p>
      <h1 className="mt-4 text-4xl">Test payment</h1>
      <p className="mt-4 text-muted">This page simulates the payment provider. The result is sent to our server as a signed provider callback.</p>
      <SandboxPay checkoutId={checkoutId ?? null} locale={locale} />
    </div>
  );
}
