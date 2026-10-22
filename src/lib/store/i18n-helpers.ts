import type { Locale } from "@/contracts/common";
import { SUPPORTED_LOCALES } from "@/contracts/common";

/** Narrow a route locale to the contract locale enum (falls back to "en"). */
export function apiLocale(l: string): Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(l) ? (l as Locale) : "en";
}
