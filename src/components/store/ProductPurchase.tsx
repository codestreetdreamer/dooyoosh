"use client";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ProductDetail, PublicVariant } from "@/contracts/catalog";
import { Link } from "@/i18n/navigation";
import { useBag } from "@/lib/store/bag";
import { Price } from "./Price";

/**
 * Variant selection + add to bag. Public data exposes availability only (no stock counts) —
 * unavailable sizes/colours are shown but disabled and announced as sold out.
 */
export function ProductPurchase({ product, locale }: { product: ProductDetail; locale: string }) {
  const t = useTranslations("product");
  const { add } = useBag();
  const variants = product.variants;
  const colours = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const v of variants) if (v.colour && !seen.has(v.colour)) seen.set(v.colour, v.colourHex);
    return [...seen.entries()].map(([name, hex]) => ({ name, hex }));
  }, [variants]);
  const sizes = useMemo(() => [...new Set(variants.map((v) => v.size).filter((s): s is string => !!s))], [variants]);

  const firstAvailable = variants.find((v) => v.available);
  const [colour, setColour] = useState<string | null>(firstAvailable?.colour ?? colours[0]?.name ?? null);
  const [size, setSize] = useState<string | null>(sizes.length === 0 ? null : null);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = (c: string | null, s: string | null): PublicVariant | undefined =>
    variants.find((v) => (colours.length === 0 || v.colour === c) && (sizes.length === 0 || v.size === s));
  const colourAvailable = (c: string) => variants.some((v) => v.colour === c && v.available);
  const sizeAvailable = (s: string) => variants.some((v) => v.size === s && (colours.length === 0 || v.colour === colour) && v.available);

  const selected = find(colour, size);
  const needsSize = sizes.length > 0 && !size;
  const canAdd = !!selected && selected.available;
  const displayPrice = selected?.priceMinor ?? product.priceFromMinor;

  const onAdd = () => {
    if (needsSize) {
      setError(t("selectSize"));
      return;
    }
    if (!selected || !selected.available) return;
    add({
      variantId: selected.id,
      quantity: 1,
      snapshot: {
        productSlug: product.slug,
        productName: product.name,
        size: selected.size,
        colour: selected.colour,
        imageUrl: product.image?.url ?? null,
        unitPriceMinor: selected.priceMinor,
        currency: selected.currency,
      },
    });
    setError(null);
    setAdded(true);
  };

  return (
    <div>
      <h1 className="text-4xl leading-tight md:text-5xl">{product.name}</h1>
      <Price amountMinor={displayPrice} currency={selected?.currency ?? product.currency} locale={locale} className="mt-3 block text-lg" />

      {!product.available ? <p className="mt-6 border border-line bg-surface p-4 text-sm">{t("allSoldOut")}</p> : null}

      {colours.length > 0 ? (
        <fieldset className="mt-8">
          <legend className="text-xs uppercase tracking-[0.18em]">
            {t("colour")}: <span className="normal-case tracking-normal text-muted">{colour}</span>
          </legend>
          <div className="mt-3 flex flex-wrap gap-3">
            {colours.map((c) => {
              const avail = colourAvailable(c.name);
              return (
                <label key={c.name} className="relative cursor-pointer">
                  <input
                    type="radio"
                    name="colour"
                    value={c.name}
                    checked={colour === c.name}
                    onChange={() => {
                      setColour(c.name);
                      setAdded(false);
                      if (size && !variants.some((v) => v.colour === c.name && v.size === size && v.available)) setSize(null);
                    }}
                    className="peer sr-only"
                    aria-label={`${c.name}${avail ? "" : ` — ${t("soldOut")}`}`}
                  />
                  <span
                    aria-hidden
                    className={`block h-9 w-9 rounded-full border border-line ring-offset-2 ring-offset-bg peer-checked:ring-1 peer-checked:ring-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ink ${avail ? "" : "opacity-40"}`}
                    style={{ backgroundColor: c.hex ?? "#ccc" }}
                  />
                  {!avail ? <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-px w-10 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-ink" /> : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {sizes.length > 0 ? (
        <fieldset className="mt-8" aria-describedby={error ? "size-error" : undefined}>
          <legend className="text-xs uppercase tracking-[0.18em]">{t("size")}</legend>
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">
            {sizes.map((s) => {
              const avail = sizeAvailable(s);
              return (
                <label key={s} className={avail ? "cursor-pointer" : "cursor-not-allowed"}>
                  <input
                    type="radio"
                    name="size"
                    value={s}
                    disabled={!avail}
                    checked={size === s}
                    onChange={() => {
                      setSize(s);
                      setError(null);
                      setAdded(false);
                    }}
                    className="peer sr-only"
                    aria-label={`${s}${avail ? "" : ` — ${t("soldOut")}`}`}
                  />
                  <span
                    aria-hidden
                    className={`flex h-12 items-center justify-center border text-sm peer-checked:border-ink peer-checked:bg-ink peer-checked:text-bg peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink ${avail ? "border-line bg-surface hover:border-ink" : "border-line text-muted line-through opacity-60"}`}
                  >
                    {s}
                  </span>
                </label>
              );
            })}
          </div>
          {error ? <p id="size-error" role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
        </fieldset>
      ) : null}

      <div className="mt-8">
        <button
          type="button"
          onClick={onAdd}
          disabled={!product.available || (!needsSize && !canAdd)}
          className="btn btn-primary w-full"
        >
          {!product.available || (!needsSize && !canAdd) ? t("soldOut") : t("addToBag")}
        </button>
        <p className="mt-3 text-xs text-muted">{t("shippingNote")}</p>
        <div aria-live="polite" className="min-h-6">
          {added ? (
            <p className="mt-3 flex items-center justify-between border border-line bg-surface px-4 py-3 text-sm">
              {t("added")}
              <Link href="/bag" className="link-underline text-xs uppercase tracking-[0.18em]">{t("viewBag")}</Link>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
