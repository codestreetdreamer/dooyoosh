import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Monogram } from "./Logo";
import { NewsletterForm } from "@/components/journal/NewsletterForm";

export async function Footer() {
  const t = await getTranslations("footer");
  const nav = await getTranslations("nav");
  const cols = [
    { title: nav("shop"), links: [["/shop/clothing", nav("clothing")], ["/shop/footwear", nav("footwear")], ["/shop/accessories", nav("accessories")], ["/journal", nav("journal")]] },
    { title: t("help"), links: [["/pages/shipping", t("shipping")], ["/pages/returns", t("returns")], ["/pages/size-guide", t("sizeGuide")], ["/pages/contact", t("contact")]] },
    { title: t("legal"), links: [["/pages/privacy", t("privacy")], ["/pages/terms", t("terms")], ["/pages/cookies", t("cookies")], ["/pages/about", t("about")]] },
  ] as const;
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-[1440px] gap-12 px-4 py-16 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:px-8">
        <div>
          <Monogram className="h-20 w-20" />
          <p className="mt-4 max-w-xs font-display text-2xl leading-snug">{t("tagline")}</p>
          <div className="mt-8"><NewsletterForm /></div>
        </div>
        {cols.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className="eyebrow !font-sans">{col.title}</h2>
            <ul className="mt-4 space-y-3 text-sm">
              {col.links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="link-underline">{label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-[1440px] px-4 py-6 text-xs text-muted md:px-8">{t("rights", { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}
