/**
 * POST /cart/validate (owner: Backend & Database). The client cart is only a hint; prices/availability come from the DB.
 * Public facts (name, price, image, active/published) are read as `anon` through storefront_variants (RLS applies).
 * Stock facts need columns anon cannot read: the server role computes ONLY booleans inside SQL
 * (in_stock, enough for the requested quantity, lowStock = sellable <= LOW_STOCK_THRESHOLD), so no count ever leaves the DB.
 * Line quantities are validated by the contract (1..MAX_LINE_QTY); an over-stock request keeps its quantity and gets
 * issue "insufficient_stock" (never clamped, which would reveal the count).
 */
import "server-only";
import { type ValidateCartRequest, type ValidateCartResponse, type ValidatedCartLine } from "@/contracts/cart";
import { asAnon, getSql } from "../db/client";
import { mediaUrl, num } from "./shared";

/** "Only a few left" threshold (contract validatedCartLine.lowStock: sellable stock <= 3). */
export const LOW_STOCK_THRESHOLD = 3;

type PublicRow = { id: string; sku: string; size: string | null; colour: string | null; price_cents: string; currency: string; slug: string; name: string; image_path: string | null };

export async function validateCart(req: ValidateCartRequest): Promise<ValidateCartResponse["data"]> {
  const ids = req.items.map((i) => i.variantId);
  const qtys = req.items.map((i) => i.quantity);
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
    // server-only: existence, active/published state and stock BOOLEANS only (never a count)
    getSql()<{ id: string; active: boolean; in_stock: boolean; enough: boolean; low_stock: boolean }[]>`
      select v.id, v.is_active as active,
             (v.stock_on_hand - v.stock_reserved) > 0 as in_stock,
             (v.stock_on_hand - v.stock_reserved) >= r.qty as enough,
             (v.stock_on_hand - v.stock_reserved) <= ${LOW_STOCK_THRESHOLD} as low_stock
        from unnest(${ids}::uuid[], ${qtys}::int[]) as r(id, qty)
        join public.product_variants v on v.id = r.id`,
  ]);
  const byId = new Map(pub.map((r) => [r.id, r]));
  const stateById = new Map(caps.map((r) => [r.id, r]));
  const currency = pub[0]?.currency.trim() ?? (await marketCurrency());

  const lines: ValidatedCartLine[] = req.items.map((item) => {
    const r = byId.get(item.variantId);
    if (!r) {
      return {
        variantId: item.variantId, productSlug: "", productName: "", sku: "", size: null, colour: null, imageUrl: null,
        unitPriceMinor: 0, quantity: 0, lineTotalMinor: 0, available: false, lowStock: false,
        // exists in DB but not public: variant switched off => inactive; product draft/archived/scheduled => unpublished
        issue: !stateById.has(item.variantId) ? "not_found" : !stateById.get(item.variantId)!.active ? "inactive" : "unpublished",
      };
    }
    const st = stateById.get(item.variantId);
    const inStock = st?.in_stock ?? false;
    const unit = num(r.price_cents);
    const qty = inStock ? item.quantity : 0;
    return {
      variantId: r.id, productSlug: r.slug, productName: r.name, sku: r.sku, size: r.size, colour: r.colour,
      imageUrl: mediaUrl(r.image_path), unitPriceMinor: unit, quantity: qty, lineTotalMinor: unit * qty,
      available: inStock, lowStock: inStock && (st?.low_stock ?? false),
      issue: !inStock ? "out_of_stock" : !st?.enough ? "insufficient_stock" : null,
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
