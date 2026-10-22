"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ShippingOption } from "@/contracts/shipping";
import { Link } from "@/i18n/navigation";
import { useBag } from "@/lib/store/bag";
import { call } from "@/lib/store/data-source";
import { apiLocale } from "@/lib/store/i18n-helpers";
import { saveReservation } from "@/lib/store/reservation";
import { checkoutScope, storeToken } from "@/lib/store/url-token";
import { issueLabel } from "@/components/store/BagView";
import { IdempotencyKeeper } from "@/lib/store/idempotency";
import { EmptyState, Spinner } from "@/components/ui/States";
import { Price } from "./Price";
import { ReservationNotice } from "./ReservationNotice";
import { useValidatedBag } from "./BagView";
import { DemoBanner } from "@/components/layout/DemoBanner";

/** Countries offered in the form; the server decides shippability (422 COUNTRY_NOT_SHIPPABLE). Launch list is [OPEN]. */
const COUNTRIES: [string, string][] = [
  ["UZ", "Uzbekistan"], ["KZ", "Kazakhstan"], ["KG", "Kyrgyzstan"], ["TJ", "Tajikistan"], ["TR", "Türkiye"], ["AE", "United Arab Emirates"],
  ["PL", "Poland"], ["DE", "Germany"], ["GB", "United Kingdom"], ["US", "United States"],
];

type Fields = { email: string; phone: string; fullName: string; line1: string; line2: string; city: string; region: string; postalCode: string; country: string };
type FieldErrors = Partial<Record<keyof Fields, string>>;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9 ()-]{6,20}$/;

const FIELD_KEYS: (keyof Fields)[] = ["email", "phone", "fullName", "line1", "line2", "city", "region", "postalCode", "country"];

/** Map 400 VALIDATION_ERROR details.issues (Zod issues: { path, message }) onto form fields. */
function fieldErrorsFromIssues(details: Record<string, unknown>, fallback: string): FieldErrors {
  const out: FieldErrors = {};
  const issues = Array.isArray(details.issues) ? (details.issues as { path?: unknown[]; message?: string }[]) : [];
  for (const issue of issues) {
    const path = (issue.path ?? []).map(String);
    const key = [...path].reverse().find((p): p is keyof Fields => (FIELD_KEYS as string[]).includes(p));
    if (key && !out[key]) out[key] = issue.message && issue.message.length < 120 ? issue.message : fallback;
  }
  return out;
}


export function CheckoutForm() {
  const t = useTranslations("checkout");
  const tb = useTranslations("bag");
  const locale = useLocale();
  const { lines } = useBag();
  const bag = useValidatedBag();
  const [f, setF] = useState<Fields>({ email: "", phone: "", fullName: "", line1: "", line2: "", city: "", region: "", postalCode: "", country: "UZ" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [options, setOptions] = useState<{ status: "loading" | "ok" | "none" | "error"; list: ShippingOption[] }>({ status: "loading", list: [] });
  const [methodId, setMethodId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const idem = useRef(new IdempotencyKeeper());
  const [conflictIds, setConflictIds] = useState<Set<string>>(new Set());
  const bannerRef = useRef<HTMLDivElement>(null);

  const subtotal = bag.data?.subtotalMinor;
  useEffect(() => {
    let cancelled = false;
    setOptions({ status: "loading", list: [] });
    void call("shippingOptions", { query: { country: f.country, locale: apiLocale(locale), subtotalMinor: subtotal } }).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setOptions({ status: res.error.code === "COUNTRY_NOT_SHIPPABLE" ? "none" : "error", list: [] });
        setMethodId("");
        return;
      }
      const list = res.data.data.options;
      setOptions({ status: list.length ? "ok" : "none", list });
      setMethodId((cur) => (list.some((o) => o.methodId === cur) ? cur : (list[0]?.methodId ?? "")));
    });
    return () => { cancelled = true; };
  }, [f.country, locale, subtotal]);

  const method = options.list.find((o) => o.methodId === methodId);
  const shippingMinor = useMemo(() => {
    if (!method || subtotal === undefined) return undefined;
    return method.freeOverMinor !== null && subtotal >= method.freeOverMinor ? 0 : method.priceMinor;
  }, [method, subtotal]);

  if (bag.ready && lines.length === 0) {
    return <EmptyState title={t("emptyBag")} action={<Link href="/shop" className="btn btn-primary">{t("backToBag")}</Link>} />;
  }

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setF((prev) => ({ ...prev, [k]: e.target.value }));
    if (errors[k]) setErrors((prev) => ({ ...prev, [k]: undefined }));
    if (banner === t("fixErrors")) setBanner(null);
  };

  const validate = (): FieldErrors => {
    const e: FieldErrors = {};
    if (!f.email.trim()) e.email = t("required");
    else if (!EMAIL_RE.test(f.email.trim())) e.email = t("invalidEmail");
    if (f.phone.trim() && !PHONE_RE.test(f.phone.trim())) e.phone = t("invalidPhone");
    for (const k of ["fullName", "line1", "city", "country"] as const) if (!f[k].trim()) e[k] = t("required");
    return e;
  };

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBanner(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      setBanner(t("fixErrors"));
      const firstKey = Object.keys(e)[0];
      document.getElementById(`co-${firstKey}`)?.focus();
      return;
    }
    if (!methodId || !bag.data) return;
    setSubmitting(true);
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    const payload = {
      email: f.email.trim(),
      phone: opt(f.phone),
      locale: apiLocale(locale),
      items: lines.map((l) => ({
        variantId: l.variantId,
        quantity: l.quantity,
        expectedUnitPriceMinor: bag.data?.lines.find((x) => x.variantId === l.variantId)?.unitPriceMinor,
      })),
      shippingAddress: {
        fullName: f.fullName.trim(), line1: f.line1.trim(), line2: opt(f.line2), city: f.city.trim(),
        region: opt(f.region), postalCode: opt(f.postalCode), country: f.country, phone: opt(f.phone),
      },
      shippingMethodId: methodId,
    };
    const send = () => call("createCheckout", { body: { ...payload, idempotencyKey: idem.current.keyFor(payload) } });
    let res = await send();
    // 409 IDEMPOTENCY_CONFLICT = key already used for a different payload (or a closed checkout): new key, retry once.
    if (!res.ok && res.error.code === "IDEMPOTENCY_CONFLICT") {
      idem.current.reset();
      res = await send();
    }
    if (!res.ok) {
      setSubmitting(false);
      const code = res.error.code;
      const known = ["OUT_OF_STOCK", "PRICE_CHANGED", "COUNTRY_NOT_SHIPPABLE", "PAYMENT_ERROR", "VALIDATION_ERROR"] as const;
      setBanner((known as readonly string[]).includes(code) ? t(code as (typeof known)[number]) : t("GENERIC"));
      if (code === "VALIDATION_ERROR") {
        // 400: show per-field errors from the server (or client-side contract check in api-client).
        const fe = fieldErrorsFromIssues(res.error.details, t("required"));
        setErrors(fe);
        const firstKey = Object.keys(fe)[0];
        if (firstKey) {
          document.getElementById(`co-${firstKey}`)?.focus();
          return;
        }
      }
      if (code === "COUNTRY_NOT_SHIPPABLE") {
        // 422 is only ever COUNTRY_NOT_SHIPPABLE.
        setErrors({ country: t("COUNTRY_NOT_SHIPPABLE") });
        document.getElementById("co-country")?.focus();
        return;
      }
      if (code === "OUT_OF_STOCK" || code === "PRICE_CHANGED") {
        // Server rejected the bag (details.variantIds): refresh prices/availability from the server and let the customer review.
        idem.current.reset();
        const ids = Array.isArray(res.error.details?.variantIds) ? (res.error.details.variantIds as unknown[]).map(String) : [];
        setConflictIds(new Set(ids));
        await bag.revalidate();
      }
      requestAnimationFrame(() => bannerRef.current?.focus());
      return;
    }
    const d = res.data.data;
    let url: URL | null = null;
    try { url = new URL(d.redirectUrl); } catch { url = null; }
    if (!url || !/^https?:$/.test(url.protocol)) {
      setSubmitting(false);
      setBanner(t("PAYMENT_ERROR"));
      return;
    }
    // Guest token is returned once; keep it only in sessionStorage (sandbox-pay, return and order pages read it from there).
    storeToken(checkoutScope(d.checkoutId), d.accessToken);
    saveReservation({ checkoutId: d.checkoutId, token: null, reservedUntil: d.reservedUntil, expiresAt: d.expiresAt });
    window.location.assign(url.toString());
  };

  const field = (k: keyof Fields, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`co-${k}`} className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-muted">{label}</label>
      <input
        id={`co-${k}`}
        name={k}
        value={f[k]}
        onChange={set(k)}
        aria-invalid={errors[k] ? true : undefined}
        aria-describedby={errors[k] ? `co-${k}-err` : undefined}
        className="field"
        {...props}
      />
      {errors[k] ? <p id={`co-${k}-err`} className="mt-1 text-sm text-danger">{errors[k]}</p> : null}
    </div>
  );

  const currency = bag.data?.currency;
  const total = subtotal !== undefined && shippingMinor !== undefined ? subtotal + shippingMinor : undefined;
  const blocked = submitting || !bag.data || !bag.data.allAvailable || !methodId || options.status !== "ok";

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-12 lg:grid-cols-12">
      <div className="space-y-12 lg:col-span-7">
        <div ref={bannerRef} tabIndex={-1} aria-live="assertive" className="focus:outline-none">
          {banner ? (
            <div role="alert" className="border border-danger bg-surface p-4 text-sm">
              <p>{banner}</p>
              <Link href="/bag" className="link-underline mt-2 inline-block text-xs uppercase tracking-[0.16em]">{t("backToBag")}</Link>
            </div>
          ) : null}
        </div>
        <fieldset className="space-y-4">
          <legend className="mb-4 font-display text-3xl">{t("contact")}</legend>
          {field("email", t("email"), { type: "email", autoComplete: "email", required: true, inputMode: "email" })}
          {field("phone", t("phone"), { type: "tel", autoComplete: "tel", inputMode: "tel" })}
        </fieldset>
        <fieldset className="space-y-4">
          <legend className="mb-4 font-display text-3xl">{t("shipping")}</legend>
          {field("fullName", t("fullName"), { autoComplete: "name", required: true })}
          {field("line1", t("line1"), { autoComplete: "address-line1", required: true })}
          {field("line2", t("line2"), { autoComplete: "address-line2" })}
          <div className="grid gap-4 md:grid-cols-2">
            {field("city", t("city"), { autoComplete: "address-level2", required: true })}
            {field("region", t("region"), { autoComplete: "address-level1" })}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {field("postalCode", t("postalCode"), { autoComplete: "postal-code" })}
            <div>
              <label htmlFor="co-country" className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-muted">{t("country")}</label>
              <select id="co-country" name="country" value={f.country} onChange={set("country")} autoComplete="country" className="field" aria-invalid={errors.country ? true : undefined} aria-describedby={errors.country ? "co-country-err" : undefined}>
                {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
              {errors.country ? <p id="co-country-err" className="mt-1 text-sm text-danger">{errors.country}</p> : null}
            </div>
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-4 font-display text-3xl">{t("delivery")}</legend>
          {options.status === "loading" ? <Spinner label={t("loadingOptions")} /> : null}
          {options.status === "none" ? <p role="alert" className="text-sm text-danger">{t("noOptions")}</p> : null}
          {options.status === "error" ? <p role="alert" className="text-sm text-danger">{t("GENERIC")}</p> : null}
          <div className="space-y-3">
            {options.list.map((o) => {
              const free = o.freeOverMinor !== null && subtotal !== undefined && subtotal >= o.freeOverMinor;
              return (
                <label key={o.methodId} className="flex cursor-pointer items-center justify-between gap-4 border border-line bg-surface p-4 has-[:checked]:border-ink">
                  <span className="flex items-center gap-3">
                    <input type="radio" name="shippingMethod" value={o.methodId} checked={methodId === o.methodId} onChange={() => setMethodId(o.methodId)} className="h-4 w-4 accent-[var(--color-text)]" />
                    <span>
                      <span className="block text-sm">{o.name}</span>
                      <span className="block text-xs text-muted">{t("days", { min: o.minDays, max: o.maxDays })}</span>
                    </span>
                  </span>
                  <span className="text-sm">{free ? t("free") : <Price amountMinor={o.priceMinor} currency={o.currency} locale={locale} />}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <aside aria-labelledby="co-summary" className="lg:col-span-5">
        <div className="border border-line bg-surface p-6 lg:sticky lg:top-28">
          <h2 id="co-summary" className="text-2xl">{t("summary")}</h2>
          {!bag.data ? (bag.status === "error" ? <p role="alert" className="mt-4 text-sm text-danger">{tb("validateError")}</p> : <div className="mt-4"><Spinner label={tb("validating")} /></div>) : (
            <>
              <ul className="mt-4 divide-y divide-line text-sm">
                {bag.data.lines.map((l) => (
                  <li key={l.variantId} className="flex justify-between gap-4 py-3">
                    <span>
                      {l.productName} <span className="text-muted">× {l.quantity}</span>
                      <span className="block text-xs text-muted">{[l.colour, l.size].filter(Boolean).join(" · ")}</span>
                      {l.issue ? <span className="block text-xs text-danger">{issueLabel(l.issue, tb)}</span>
                        : conflictIds.has(l.variantId) ? <span className="block text-xs text-danger">{tb("conflictLine")}</span>
                        : l.lowStock ? <span className="block text-xs text-accent-strong">{tb("lowStock")}</span> : null}
                    </span>
                    <Price amountMinor={l.lineTotalMinor} currency={bag.data!.currency} locale={locale} />
                  </li>
                ))}
              </ul>
              <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
                <div className="flex justify-between"><dt>{t("subtotal")}</dt><dd><Price amountMinor={bag.data.subtotalMinor} currency={bag.data.currency} locale={locale} /></dd></div>
                <div className="flex justify-between"><dt>{t("shippingCost")}</dt><dd>{shippingMinor === undefined ? "—" : shippingMinor === 0 ? t("free") : <Price amountMinor={shippingMinor} currency={currency!} locale={locale} />}</dd></div>
                <div className="flex justify-between border-t border-line pt-3 text-base"><dt>{t("total")}</dt><dd>{total === undefined ? "—" : <Price amountMinor={total} currency={currency!} locale={locale} />}</dd></div>
              </dl>
              <p className="mt-2 text-xs text-muted">{t("totalNote")}</p>
            </>
          )}
          <div className="mt-6"><ReservationNotice text={t("reservationNote")} countdownLabel="{time}" /></div>
          <div className="mt-4"><DemoBanner variant="inline" /></div>
          <button type="submit" disabled={blocked} className="btn btn-primary mt-6 w-full" aria-busy={submitting}>
            {submitting ? t("submitting") : t("pay")}
          </button>
        </div>
      </aside>
    </form>
  );
}
