"use client";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { call } from "@/lib/store/data-source";
import { apiLocale } from "@/lib/store/i18n-helpers";

/** Double opt-in signup (POST /newsletter, always 202 — no enumeration). Honeypot field `website` stays empty. */
export function NewsletterForm() {
  const t = useTranslations("newsletter");
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "invalid" | "error" | "limited">("idle");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setState("invalid");
    setState("sending");
    const res = await call("newsletterSignup", { body: { email: v, locale: apiLocale(locale), ...(website ? { website } : {}) } });
    if (res.ok) setState("sent");
    else setState(res.status === 400 ? "invalid" : res.status === 429 ? "limited" : "error");
  }
  if (state === "sent") return <p role="status" className="text-sm">{t("sent")}</p>;
  return (
    <form onSubmit={submit} noValidate className="max-w-sm" aria-labelledby="nl-title">
      <h2 id="nl-title" className="eyebrow !font-sans">{t("title")}</h2>
      <p className="mt-3 text-sm text-muted">{t("body")}</p>
      <div className="mt-4 flex gap-2">
        <label htmlFor="nl-email" className="sr-only">{t("email")}</label>
        <input id="nl-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="field flex-1" placeholder={t("email")} aria-invalid={state === "invalid" ? true : undefined} aria-describedby={state === "invalid" || state === "error" || state === "limited" ? "nl-msg" : undefined} />
        <button type="submit" className="btn btn-primary" disabled={state === "sending"}>{t("submit")}</button>
      </div>
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="nl-website">Website</label>
        <input id="nl-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      {state === "invalid" || state === "error" || state === "limited" ? (
        <p id="nl-msg" role="alert" className="mt-2 text-sm text-danger">{t(state)}</p>
      ) : null}
    </form>
  );
}
