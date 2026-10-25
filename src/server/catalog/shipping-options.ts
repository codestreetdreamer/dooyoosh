/**
 * GET /shipping/options (owner: Backend & Database; the checkout-time price calculation lives in Payments' src/server/shipping).
 * Reads markets/countries/shipping_* as anon (RLS: active/shippable only). Rate = highest min_subtotal tier <= subtotal hint.
 */
import "server-only";
import type { ShippingOptionsQuery, ShippingOptionsResponse } from "@/contracts/shipping";
import { ApiError } from "@/lib/errors";
import { asAnon } from "../db/client";
import { num } from "./shared";

export async function shippingOptions(q: ShippingOptionsQuery): Promise<ShippingOptionsResponse["data"]> {
  return asAnon(async (tx) => {
    const [country] = await tx<{ currency: string; market_id: string }[]>`
      select m.currency, m.id as market_id from public.countries c join public.markets m on m.id = c.market_id
       where c.iso2 = ${q.country} and c.is_shippable and m.is_active`;
    if (!country) throw ApiError.countryNotShippable(q.country);
    const subtotal = q.subtotalMinor ?? 0;
    const rows = await tx<{ id: string; code: string; name: string; min_days: number; max_days: number; price_cents: string; free_over_cents: string | null }[]>`
      select sm.id, sm.code, sm.name, sm.min_days, sm.max_days, r.price_cents, r.free_over_cents
        from public.shipping_methods sm
        join lateral (select price_cents, free_over_cents from public.shipping_rates r
                       where r.shipping_method_id = sm.id and r.min_subtotal_cents <= ${subtotal}
                       order by r.min_subtotal_cents desc limit 1) r on true
       where sm.market_id = ${country.market_id} and sm.is_active
       order by r.price_cents, sm.min_days, sm.code`;
    const currency = country.currency.trim();
    return {
      country: q.country,
      currency,
      options: rows.map((r) => {
        const freeOver = r.free_over_cents == null ? null : num(r.free_over_cents);
        const free = freeOver != null && q.subtotalMinor != null && q.subtotalMinor >= freeOver;
        return { methodId: r.id, code: r.code, name: r.name, minDays: r.min_days, maxDays: r.max_days, priceMinor: free ? 0 : num(r.price_cents), freeOverMinor: freeOver, currency };
      }),
    };
  });
}
