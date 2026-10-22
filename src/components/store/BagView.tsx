"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ValidateCartResponse } from "@/contracts/cart";
import { Link } from "@/i18n/navigation";
import { useBag, type BagLine } from "@/lib/store/bag";
import { call } from "@/lib/store/data-source";
import { apiLocale } from "@/lib/store/i18n-helpers";
import { Img } from "@/components/ui/Img";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States";
import { Price } from "./Price";
import { ReservationNotice } from "./ReservationNotice";

type Validated = ValidateCartResponse["data"];

/** Server-validated bag: prices, availability and subtotal always come from POST /cart/validate. */
export function useValidatedBag() {
  const locale = useLocale();
  const { lines, ready, replace } = useBag();
  const [state, setState] = useState<{ status: "idle" | "loading" | "ok" | "error"; data?: Validated }>({ status: "idle" });
  const key = lines.map((l) => `${l.variantId}:${l.quantity}`).join(",");
  const linesRef = useRef(lines);
  linesRef.current = lines;

  const validate = useCallback(async () => {
    const current = linesRef.current;
    if (current.length === 0) {
      setState({ status: "ok", data: undefined });
      return;
    }
    setState((s) => ({ status: "loading", data: s.data }));
    const res = await call("validateCart", {
      body: { items: current.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), locale: apiLocale(locale) },
    });
    if (!res.ok) {
      setState({ status: "error" });
      return;
    }
    const data = res.data.data;
    // Reconcile the client hint with server truth (price changes, reduced quantities).
    let changed = false;
    const next: BagLine[] = current.map((l) => {
      const v = data.lines.find((x) => x.variantId === l.variantId);
      if (!v) return l;
      const qty = v.available && v.maxQuantity > 0 && l.quantity > v.maxQuantity ? v.maxQuantity : l.quantity;
      if (qty !== l.quantity || v.unitPriceMinor !== l.snapshot.unitPriceMinor || data.currency !== l.snapshot.currency) changed = true;
      return { ...l, quantity: qty, snapshot: { ...l.snapshot, unitPriceMinor: v.unitPriceMinor, currency: data.currency } };
    });
    if (changed) replace(next);
    setState({ status: "ok", data });
  }, [locale, replace]);

  useEffect(() => {
    if (ready) void validate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revalidate when lines/quantities change
  }, [ready, key]);

  return { ...state, revalidate: validate, ready, lines };
}

export function BagView() {
  const t = useTranslations("bag");
  const locale = useLocale();
  const { setQuantity, remove } = useBag();
  const { status, data, revalidate, ready, lines } = useValidatedBag();

  if (!ready) return <div className="py-20 text-center"><Spinner label={t("validating")} /></div>;
  if (lines.length === 0) {
    return (
      <EmptyState title={t("emptyTitle")} action={<Link href="/shop" className="btn btn-primary">{t("continue")}</Link>}>
        {t("emptyBody")}
      </EmptyState>
    );
  }

  const blocked = !data || !data.allAvailable || status !== "ok";

  return (
    <div className="grid gap-12 lg:grid-cols-12">
      <section aria-labelledby="bag-items" className="lg:col-span-8">
        <h2 id="bag-items" className="sr-only">{t("title")}</h2>
        {status === "error" ? (
          <ErrorState title={t("errorTitle")} action={<button type="button" className="btn btn-outline" onClick={() => void revalidate()}>{t("retry")}</button>}>
            {t("errorBody")}
          </ErrorState>
        ) : null}
        <ul className="divide-y divide-line border-y border-line">
          {lines.map((l) => {
            const v = data?.lines.find((x) => x.variantId === l.variantId);
            const issue = v?.issue ?? null;
            const name = v?.productName ?? l.snapshot.productName;
            const currency = data?.currency ?? l.snapshot.currency;
            const unit = v?.unitPriceMinor ?? l.snapshot.unitPriceMinor;
            const maxQ = v?.available ? Math.max(1, v.maxQuantity) : 10;
            return (
              <li key={l.variantId} className="grid grid-cols-[96px_1fr] gap-4 py-6 md:grid-cols-[120px_1fr_auto] md:gap-6">
                <Link href={`/product/${l.snapshot.productSlug}`} className="relative block aspect-[4/5] bg-line">
                  {l.snapshot.imageUrl ? <Img src={l.snapshot.imageUrl} alt={name} fill sizes="120px" className="object-cover" /> : null}
                </Link>
                <div>
                  <h3 className="font-sans text-base">
                    <Link href={`/product/${l.snapshot.productSlug}`} className="link-underline">{name}</Link>
                  </h3>
                  <p className="mt-1 text-sm text-muted">{[l.snapshot.colour, l.snapshot.size].filter(Boolean).join(" · ")}</p>
                  <Price amountMinor={unit} currency={currency} locale={locale} className="mt-1 block text-sm" />
                  {issue ? (
                    <p role="alert" className="mt-2 text-sm text-danger">
                      {issue === "insufficient_stock" ? t("issue_insufficient_stock", { max: v?.maxQuantity ?? 0 }) : t(`issue_${issue}`)}
                    </p>
                  ) : null}
                  <div className="mt-4 flex items-center gap-6">
                    <div className="flex items-center border border-line" role="group" aria-label={`${t("quantity")}: ${name}`}>
                      <button type="button" className="h-10 w-10" aria-label={t("decrease", { name })} disabled={l.quantity <= 1 || !!issue} onClick={() => setQuantity(l.variantId, l.quantity - 1)}>−</button>
                      <span className="w-8 text-center text-sm" aria-live="polite">{l.quantity}</span>
                      <button type="button" className="h-10 w-10" aria-label={t("increase", { name })} disabled={l.quantity >= maxQ || !!issue} onClick={() => setQuantity(l.variantId, l.quantity + 1)}>+</button>
                    </div>
                    <button type="button" onClick={() => remove(l.variantId)} className="link-underline text-xs uppercase tracking-[0.16em]" aria-label={t("removeItem", { name })}>
                      {t("remove")}
                    </button>
                  </div>
                </div>
                <div className="col-start-2 text-sm md:col-start-auto md:text-right">
                  {v ? <Price amountMinor={v.lineTotalMinor} currency={currency} locale={locale} /> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <aside aria-labelledby="bag-summary" className="lg:col-span-4">
        <div className="border border-line bg-surface p-6 lg:sticky lg:top-28">
          <h2 id="bag-summary" className="text-2xl">{t("subtotal")}</h2>
          <div className="mt-4 flex items-baseline justify-between" aria-live="polite">
            {status === "loading" && !data ? <Spinner label={t("validating")} /> : data ? (
              <Price amountMinor={data.subtotalMinor} currency={data.currency} locale={locale} className="text-xl" />
            ) : null}
          </div>
          <p className="mt-2 text-xs text-muted">{t("shippingAtCheckout")}</p>
          <div className="mt-6">
            <ReservationNotice text={t("reservation")} countdownLabel={t("reservedFor", { time: "{time}" })} />
          </div>
          {blocked ? (
            <span aria-disabled="true" className="btn btn-primary mt-6 w-full cursor-not-allowed opacity-60">{t("checkout")}</span>
          ) : (
            <Link href="/checkout" className="btn btn-primary mt-6 w-full">{t("checkout")}</Link>
          )}
          <Link href="/shop" className="link-underline mt-4 block text-center text-xs uppercase tracking-[0.16em]">{t("continue")}</Link>
        </div>
      </aside>
    </div>
  );
}
