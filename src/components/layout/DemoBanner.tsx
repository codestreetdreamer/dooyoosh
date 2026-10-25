"use client";
import { useTranslations } from "next-intl";
import { isDemoMode } from "@/lib/store/demo-mode";

/** Persistent, non-dismissable demo notice. Shown whenever NEXT_PUBLIC_PAYMENT_MODE !== "live" (default: shown). */
export function DemoBanner({ variant = "site" }: { variant?: "site" | "inline" }) {
  const t = useTranslations("demo");
  if (!isDemoMode()) return null;
  if (variant === "inline") {
    return (
      <p role="note" data-testid="demo-notice" className="border border-accent-strong bg-surface px-4 py-3 text-sm text-ink">
        <strong className="mr-2 text-xs uppercase tracking-[0.16em] text-accent-strong">{t("label")}</strong>
        {t("banner")}
      </p>
    );
  }
  return (
    <div role="note" data-testid="demo-banner" className="bg-accent-strong px-4 py-2 text-center text-xs tracking-wide text-bg">
      {t("banner")}
    </div>
  );
}
