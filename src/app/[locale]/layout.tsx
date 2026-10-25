import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { Cormorant_Garamond, Inter } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { BagProvider } from "@/lib/store/bag";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { DevFixturesBanner } from "@/components/layout/DevFixturesBanner";
import { DemoBanner } from "@/components/layout/DemoBanner";
import "@/lib/store/fixtures-guard"; // throws at build time if fixtures are requested in production
import "@/styles/globals.css";

const serif = Cormorant_Garamond({ subsets: ["latin", "latin-ext", "cyrillic"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-serif-family", display: "swap" });
const sans = Inter({ subsets: ["latin", "latin-ext", "cyrillic"], variable: "--font-sans-family", display: "swap" });

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = { themeColor: "#f8f0ed", width: "device-width", initialScale: 1 };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
    title: { default: t("title"), template: "%s — Dooyoosh" },
    description: t("description"),
    icons: { icon: "/brand/favicon.ico", apple: "/brand/apple-icon.png" },
    openGraph: { siteName: "Dooyoosh", type: "website", locale },
  };
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();
  const t = await getTranslations("nav");
  return (
    <html lang={locale} className={`${serif.variable} ${sans.variable}`}>
      <body className="flex min-h-dvh flex-col bg-bg text-ink">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <BagProvider>
            <a href="#main" className="sr-only z-50 bg-ink px-4 py-3 text-bg focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
              {t("skip")}
            </a>
            <DemoBanner />
            <DevFixturesBanner />
            <Header />
            <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
              {children}
            </main>
            <Footer />
          </BagProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
