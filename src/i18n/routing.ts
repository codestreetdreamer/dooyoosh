import { defineRouting } from "next-intl/routing";

/** English at launch; add "uz" (and messages/uz.json) to enable Uzbek. */
export const routing = defineRouting({
  locales: ["en"],
  defaultLocale: "en",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
