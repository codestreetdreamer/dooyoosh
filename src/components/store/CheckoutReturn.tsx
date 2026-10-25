"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { CheckoutStatusResponse } from "@/contracts/orders";
import { Link } from "@/i18n/navigation";
import { useBag } from "@/lib/store/bag";
import { call } from "@/lib/store/data-source";
import { clearReservation } from "@/lib/store/reservation";
import { checkoutScope, orderScope, storeToken, useStoredToken } from "@/lib/store/url-token";
import { guestAuth } from "@/lib/store/guest-auth";
import { ErrorState, Spinner } from "@/components/ui/States";
import { DemoBanner } from "@/components/layout/DemoBanner";

type S = CheckoutStatusResponse["data"];
const POLL_MS = 2500;
const MAX_POLLS = 48; // ~2 minutes, then keep the "pending" message

/**
 * Provider return page. URL params only IDENTIFY the checkout; payment state is always read from the server
 * (GET /checkout/{id}/status?token=), which only the verified provider callback can move to completed (spec §4.6).
 */
export function CheckoutReturn({ checkoutId }: { checkoutId: string | null }) {
  const t = useTranslations("order");
  const token = useStoredToken(checkoutId ? checkoutScope(checkoutId) : null);
  const { clear } = useBag();
  const [state, setState] = useState<{ kind: "loading" | "ok" | "notfound" | "error"; data?: S }>({ kind: "loading" });
  const polls = useRef(0);
  const cleared = useRef(false);

  useEffect(() => {
    if (token === undefined) return; // still reading the token
    if (!checkoutId || !token) {
      setState({ kind: "notfound" });
      return;
    }
    let timer: number | undefined;
    let stop = false;
    const tick = async () => {
      const res = await call("checkoutStatus", { params: { checkoutId }, ...guestAuth(token) });
      if (stop) return;
      if (!res.ok) {
        setState({ kind: res.status === 404 || res.status === 400 ? "notfound" : "error" });
        return;
      }
      const d = res.data.data;
      // Same guest token grants access to the order; keep it out of URLs (sessionStorage only).
      if (d.orderReference) storeToken(orderScope(d.orderReference), token);
      setState({ kind: "ok", data: d });
      const settled = d.checkoutStatus === "completed" || d.checkoutStatus === "failed" || d.checkoutStatus === "expired";
      if (d.checkoutStatus === "completed" && d.orderStatus === "paid" && !cleared.current) {
        cleared.current = true;
        clear();
        clearReservation();
      }
      if (!settled && ++polls.current < MAX_POLLS) timer = window.setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [checkoutId, token, clear]);

  if (state.kind === "loading") return <div className="py-16"><Spinner label={t("checking")} /></div>;
  if (state.kind === "notfound") return <ErrorState title={t("notFoundTitle")}>{t("notFoundBody")}</ErrorState>;
  if (state.kind === "error") return <ErrorState title={t("pendingTitle")}>{t("pendingBody")}</ErrorState>;

  const d = state.data!;
  const orderHref = d.orderReference ? `/order/${d.orderReference}` : null;
  let title = t("pendingTitle");
  let body: string | null = t("pendingBody");
  if (d.checkoutStatus === "completed" && d.orderStatus === "stock_conflict") { title = t("conflictTitle"); body = t("conflictBody"); }
  else if (d.checkoutStatus === "completed") { title = t("paidTitle"); body = null; }
  else if (d.checkoutStatus === "failed") { title = t("failedTitle"); body = t("failedBody"); }
  else if (d.checkoutStatus === "expired") { title = t("expiredTitle"); body = t("failedBody"); }

  return (
    <div aria-live="polite">
      <div className="mb-8"><DemoBanner variant="inline" /></div>
      <h2 className="text-4xl md:text-5xl">{title}</h2>
      {body ? <p className="mt-4 max-w-prose text-muted">{body}</p> : null}
      {d.orderReference ? (
        <p className="mt-8 text-sm">{t("reference")}: <strong className="font-medium tracking-wide">{d.orderReference}</strong></p>
      ) : null}
      {d.orderStatus ? <p className="mt-1 text-sm text-muted">{t("status")}: {t(`status_${d.orderStatus}`)}</p> : null}
      <div className="mt-10 flex flex-wrap gap-4">
        {orderHref ? <Link href={orderHref} className="btn btn-primary">{t("viewOrder")}</Link> : null}
        {d.checkoutStatus === "failed" || d.checkoutStatus === "expired" ? <Link href="/bag" className="btn btn-outline">Bag</Link> : null}
        {d.checkoutStatus !== "completed" && d.checkoutStatus !== "failed" && d.checkoutStatus !== "expired" ? <Spinner label={t("checking")} /> : null}
      </div>
    </div>
  );
}
