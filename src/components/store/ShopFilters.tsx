"use client";
import { useRouter } from "next/navigation";
import { useRef } from "react";

type Labels = Record<"filters" | "size" | "anySize" | "colour" | "anyColour" | "minPrice" | "maxPrice" | "sort" | "sortNew" | "sortPriceAsc" | "sortPriceDesc" | "apply" | "reset" | "results", string>;

/**
 * Filter + sort form. Plain GET form (works without JS); with JS, sort/select changes apply instantly.
 * Price inputs are in major units of the catalog currency; the server converts them to minor units.
 */
export function ShopFilters({ action, values, sizes, colours, labels, currency, priceRange }: {
  action: string;
  values: { sort: string; size: string; colour: string; min: string; max: string };
  sizes: { value: string; label: string }[];
  colours: { value: string; label: string }[];
  priceRange: { min: string; max: string } | null;
  labels: Labels;
  currency: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => {
    const form = formRef.current;
    if (!form) return;
    const sp = new URLSearchParams();
    new FormData(form).forEach((v, k) => {
      if (typeof v === "string" && v.trim()) sp.set(k, v.trim());
    });
    router.push(`${action}${sp.size ? `?${sp}` : ""}`, { scroll: false });
  };

  return (
    <form
      ref={formRef}
      action={action}
      method="get"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      aria-label={labels.filters}
      className="grid grid-cols-2 gap-3 border-y border-line py-5 md:grid-cols-[repeat(5,minmax(0,1fr))_auto] md:items-end"
    >
      <label className="text-xs uppercase tracking-[0.14em] text-muted">
        {labels.size}
        <select name="size" defaultValue={values.size} onChange={submit} className="field mt-1.5 text-sm normal-case tracking-normal">
          <option value="">{labels.anySize}</option>
          {values.size && !sizes.some((o) => o.value === values.size) ? <option value={values.size}>{values.size}</option> : null}
          {sizes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="text-xs uppercase tracking-[0.14em] text-muted">
        {labels.colour}
        <select name="colour" defaultValue={values.colour} onChange={submit} className="field mt-1.5 text-sm normal-case tracking-normal">
          <option value="">{labels.anyColour}</option>
          {values.colour && !colours.some((o) => o.value === values.colour) ? <option value={values.colour}>{values.colour}</option> : null}
          {colours.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="text-xs uppercase tracking-[0.14em] text-muted">
        {labels.minPrice}{currency ? ` (${currency})` : ""}
        <input name="min" type="number" inputMode="numeric" min={0} step="any" defaultValue={values.min} className="field mt-1.5 text-sm" />
      </label>
      <label className="text-xs uppercase tracking-[0.14em] text-muted">
        {labels.maxPrice}{currency ? ` (${currency})` : ""}
        <input name="max" type="number" inputMode="numeric" min={0} step="any" defaultValue={values.max} className="field mt-1.5 text-sm" />
      </label>
      <label className="col-span-2 text-xs uppercase tracking-[0.14em] text-muted md:col-span-1">
        {labels.sort}
        <select name="sort" defaultValue={values.sort} onChange={submit} className="field mt-1.5 text-sm normal-case tracking-normal">
          <option value="new">{labels.sortNew}</option>
          <option value="price_asc">{labels.sortPriceAsc}</option>
          <option value="price_desc">{labels.sortPriceDesc}</option>
        </select>
      </label>
      <div className="col-span-2 flex items-center gap-4 md:col-span-1">
        <button type="submit" className="btn btn-primary !px-5">{labels.apply}</button>
        <a href={action} className="link-underline text-xs uppercase tracking-[0.14em]">{labels.reset}</a>
      </div>
      <p className="col-span-2 text-xs text-muted md:col-span-6" aria-live="polite">
        {labels.results}
        {priceRange ? <span className="ml-3">· {priceRange.min} – {priceRange.max}</span> : null}
      </p>
    </form>
  );
}
