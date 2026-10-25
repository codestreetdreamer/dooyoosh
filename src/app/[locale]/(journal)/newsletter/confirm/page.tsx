import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { NewsletterConfirm } from "@/components/journal/NewsletterConfirm";

export const metadata: Metadata = { title: "Newsletter", robots: { index: false }, referrer: "no-referrer" };

export default async function NewsletterConfirmPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <NewsletterConfirm />;
}
