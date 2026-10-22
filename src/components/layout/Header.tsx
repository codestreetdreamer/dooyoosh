"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useBag } from "@/lib/store/bag";
import { Wordmark } from "./Logo";

const NAV = [
  { href: "/shop", key: "shop" },
  { href: "/shop/clothing", key: "clothing" },
  { href: "/shop/footwear", key: "footwear" },
  { href: "/shop/accessories", key: "accessories" },
  { href: "/journal", key: "journal" },
] as const;

export function Header() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { count, ready } = useBag();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const isActive = (href: string) => (href === "/shop" ? pathname === "/shop" : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur">
      <div className="mx-auto grid h-16 max-w-[1440px] grid-cols-[1fr_auto_1fr] items-center px-4 md:h-20 md:px-8">
        <div className="flex items-center">
          <button
            ref={toggleRef}
            type="button"
            className="-ml-2 inline-flex h-11 w-11 items-center justify-center lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? t("closeMenu") : t("openMenu")}
            onClick={() => setOpen((v) => !v)}
          >
            <span aria-hidden className="relative block h-3 w-6">
              <span className={`absolute left-0 top-0 h-px w-6 bg-ink transition-transform ${open ? "translate-y-1.5 rotate-45" : ""}`} />
              <span className={`absolute bottom-0 left-0 h-px w-6 bg-ink transition-transform ${open ? "-translate-y-1.5 -rotate-45" : ""}`} />
            </span>
          </button>
          <nav aria-label={t("primary")} className="hidden lg:block">
            <ul className="flex gap-6 whitespace-nowrap text-[0.74rem] uppercase tracking-[0.14em]">
              {NAV.filter((item) => item.key !== "journal").map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="link-underline py-1" aria-current={isActive(item.href) ? "page" : undefined}>
                    {t(item.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <Link href="/" className="justify-self-center" aria-label="Dooyoosh — home">
          <Wordmark />
        </Link>
        <div className="flex items-center justify-end gap-6">
          <Link href="/journal" className="link-underline hidden py-1 text-[0.74rem] uppercase tracking-[0.14em] lg:inline" aria-current={isActive("/journal") ? "page" : undefined}>
            {t("journal")}
          </Link>
          <Link href="/bag" className="inline-flex h-11 items-center gap-2 text-[0.74rem] uppercase tracking-[0.14em]" aria-label={t("bagCount", { count: ready ? count : 0 })}>
            <span aria-hidden>{t("bag")}</span>
            <span aria-hidden className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-ink px-1.5 text-[0.7rem] tracking-normal">
              {ready ? count : 0}
            </span>
          </Link>
        </div>
      </div>

      <div
        id="mobile-nav"
        hidden={!open}
        className="fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto bg-bg px-6 pb-10 pt-6 lg:hidden"
      >
        <nav aria-label={t("primary")}>
          <ul className="space-y-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block border-b border-line py-4 font-display text-3xl"
                  aria-current={isActive(item.href) ? "page" : undefined}
                >
                  {t(item.key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
