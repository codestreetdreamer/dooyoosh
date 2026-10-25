import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <section className="mx-auto max-w-xl px-6 py-28 text-center">
      <p className="eyebrow">404</p>
      <h1 className="mt-4 text-5xl">{t("title")}</h1>
      <p className="mt-4 text-muted">{t("body")}</p>
      <Link href="/" className="btn btn-outline mt-10">{t("home")}</Link>
    </section>
  );
}
