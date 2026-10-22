"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { PublicOrder } from "@/contracts/orders";
import { call } from "@/lib/store/data-source";
import { ErrorState, Spinner } from "@/components/ui/States";
import { Price } from "./Price";

/** Order status from GET /orders/{reference}?token= (server truth only). */
export function OrderView({ reference, token }: { reference: string; token: string | null }) {
  const t = useTranslations("order");
  const locale = useLocale();
  const [s, setS] = useState<{ kind: "loading" | "ok" | "notfound" | "error"; order?: PublicOrder }>({ kind: "loading" });

  useEffect(() => {
    if (!token) {
      setS({ kind: "notfound" });
      return;
    }
    void call("getOrder", { params: { reference }, query: { token } }).then((res) => {
      if (res.ok) setS({ kind: "ok", order: res.data.data });
      else setS({ kind: res.status === 404 || res.status === 400 ? "notfound" : "error" });
    });
  }, [reference, token]);

  if (s.kind === "loading") return <Spinner label={t("checking")} />;
  if (s.kind === "notfound") return <ErrorState title={t("notFoundTitle")}>{t("notFoundBody")}</ErrorState>;
  if (s.kind === "error") return <ErrorState title={t("pendingTitle")}>{t("pendingBody")}</ErrorState>;
  const o = s.order!;
  const heading =
    o.status === "paid" || o.status === "fulfilling" ? t("paidTitle")
    : o.status === "shipped" || o.status === "delivered" ? t("shippedTitle")
    : o.status === "stock_conflict" ? t("conflictTitle")
    : o.status === "refunded" || o.status === "partially_refunded" ? t("refundedTitle")
    : o.status === "cancelled" ? t("cancelledTitle")
    : t("pendingTitle");
  const a = o.shippingAddress;
  return (
    <div>
      <h2 className="text-4xl md:text-5xl">{heading}</h2>
      {o.status === "stock_conflict" ? <p className="mt-4 text-muted">{t("conflictBody")}</p> : null}
      <dl className="mt-8 grid gap-4 text-sm md:grid-cols-2">
        <div><dt className="eyebrow">{t("reference")}</dt><dd className="mt-1 text-base">{o.reference}</dd></div>
        <div><dt className="eyebrow">{t("status")}</dt><dd className="mt-1 text-base">{t(`status_${o.status}`)}</dd></div>
      </dl>
      <h3 className="mt-12 text-2xl">{t("items")}</h3>
      <ul className="mt-4 divide-y divide-line border-y border-line text-sm">
        {o.items.map((it) => (
          <li key={it.sku} className="flex justify-between gap-4 py-3">
            <span>{it.productName} <span className="text-muted">× {it.quantity}</span><span className="block text-xs text-muted">{[it.colour, it.size].filter(Boolean).join(" · ")}</span></span>
            <Price amountMinor={it.lineTotalMinor} currency={o.currency} locale={locale} />
          </li>
        ))}
      </ul>
      <dl className="mt-4 space-y-1 text-sm">
        <div className="flex justify-between"><dt>Subtotal</dt><dd><Price amountMinor={o.totals.subtotalMinor} currency={o.currency} locale={locale} /></dd></div>
        <div className="flex justify-between"><dt>Shipping</dt><dd><Price amountMinor={o.totals.shippingMinor} currency={o.currency} locale={locale} /></dd></div>
        <div className="flex justify-between text-base"><dt>Total</dt><dd><Price amountMinor={o.totals.totalMinor} currency={o.currency} locale={locale} /></dd></div>
      </dl>
      <h3 className="mt-12 text-2xl">{t("shipTo")}</h3>
      <address className="mt-3 text-sm not-italic leading-relaxed text-muted">
        {a.fullName}<br />{a.line1}{a.line2 ? <>, {a.line2}</> : null}<br />{[a.city, a.region, a.postalCode].filter(Boolean).join(", ")}<br />{a.country}
      </address>
      {o.shipments.filter((sh) => sh.trackingUrl).map((sh) => (
        <a key={sh.id} href={sh.trackingUrl!} target="_blank" rel="noopener noreferrer" className="btn btn-outline mt-6">{t("tracking")} — {sh.carrier}</a>
      ))}
    </div>
  );
}
