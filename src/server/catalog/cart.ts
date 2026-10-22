/**
 * POST /cart/validate (owner: Backend & Database). The client cart is only a hint; prices/availability come from the DB.
 * Public facts (name, price, image, active/published) are read as `anon` through storefront_variants (RLS applies).
 * `maxQuantity` needs stock, which anon cannot read: it is computed server-side as least(on_hand - reserved, MAX_LINE_QTY)
 * INSIDE the SQL, so exact stock never leaves the database (contract: capped at MAX_LINE_QTY).
 */
import "server-only";
import { MAX_LINE_QTY, type ValidateCartRequest, type ValidateCartResponse, type ValidatedCartLine } from "@/contracts/cart";
import { asAnon, getSql } from "../db/client";
import { mediaUrl, num } from "./shared";

type PublicRow = { id: string; sku: string; size: string | null; colour: string | null; price_cents: string; currency: string; slug: string; name: string; image_path: string | null };

export async function validateCart(req: ValidateCartRequest): Promise<ValidateCartResponse["data"]> {
  const ids = req.items.map((i) => i.variantId);
  const [pub, caps] = await Promise.all([
    asAnon((tx) => tx<PublicRow[]>`
      select sv.id, sv.sku, sv.size, sv.colour, sv.price_cents, sv.currency, sp.slug,
             coalesce(t.name, te.name, sp.slug) as name,
             (select i.storage_path from public.product_images i where i.product_id = sv.product_id
               order by (i.variant_id is distinct from sv.id), i.sort_order, i.id limit 1) as image_path
        from public.storefront_variants sv
        join public.storefront_products sp on sp.id = sv.product_id
        left join public.product_translations t on t.product_id = sp.id and t.locale = ${req.locale}
        left join public.product_translations te on te.product_id = sp.id and te.locale = 'en'
       where sv.id = any(${ids}::uuid[])`),
    // server-only: existence, active/published state + capped purchasable quantity (never the raw count)
    getSql()<{ id: string; cap: number; active: boolean; published: boolean }[]>`
      select v.id, greatest(0, least(v.stock_on_hand - v.stock_reserved, ${MAX_LINE_QTY}))::int as cap,
             v.is_active as active,
             (p.status = 'published' and p.archived_at is null and p.published_at <= now()) as published
        from public.product_variants v join public.products p on p.id = v.product_id
       where v.id = any(${ids}::uuid[])`,
  ]);
  const byId = new Map(pub.map((r) => [r.id, r]));
  const capById = new Map(caps.map((r) => [r.id, r.cap]));
  const stateById = new Map(caps.map((r) => [r.id, r]));
  const currency = pub[0]?.currency.trim() ?? (await marketCurrency());

  const lines: ValidatedCartLine[] = req.items.map((item) => {
    const r = byId.get(item.variantId);
    if (!r) {
      return {
        variantId: item.variantId, productSlug: "", productName: "", sku: "", size: null, colour: null, imageUrl: null,
        unitPriceMinor: 0, quantity: 0, lineTotalMinor: 0, available: false, maxQuantity: 0,
        // exists in DB but not public: variant switched off => inactive; product draft/archived/scheduled => unpublished
        issue: !stateById.has(item.variantId) ? "not_found" : !stateById.get(item.variantId)!.active ? "inactive" : "unpublished",
      };
    }
    const max = capById.get(item.variantId) ?? 0;
    const unit = num(r.price_cents);
    const qty = Math.min(item.quantity, max);
    return {
      variantId: r.id, productSlug: r.slug, productName: r.name, sku: r.sku, size: r.size, colour: r.colour,
      imageUrl: mediaUrl(r.image_path), unitPriceMinor: unit, quantity: qty, lineTotalMinor: unit * qty,
      available: max > 0, maxQuantity: max,
      issue: max === 0 ? "out_of_stock" : item.quantity > max ? "insufficient_stock" : null,
    };
  });
  return {
    currency,
    lines,
    subtotalMinor: lines.reduce((s, l) => s + l.lineTotalMinor, 0),
    allAvailable: lines.every((l) => l.issue === null),
  };
}

/** Currency of the active market (used only when no line is public). */
async function marketCurrency(): Promise<string> {
  const [m] = await asAnon((tx) => tx<{ currency: string }[]>`select currency from public.markets where is_active order by code limit 1`);
  return m?.currency.trim() ?? "UZS";
}
