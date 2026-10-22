import { getTranslations } from "next-intl/server";
import { usingFixtures } from "@/lib/store/data-source";

/** Visible on every page whenever the dev fixture layer is active, so it can never be mistaken for production. */
export async function DevFixturesBanner() {
  if (!usingFixtures()) return null;
  const t = await getTranslations("dev");
  return (
    <div role="note" className="bg-ink px-4 py-2 text-center text-xs tracking-wide text-bg">
      <strong className="mr-2 uppercase tracking-[0.18em]">Dev fixtures</strong>
      {t("fixtures")}
    </div>
  );
}
