"use client";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { call } from "@/lib/store/data-source";
import { Link } from "@/i18n/navigation";
import { Spinner } from "@/components/ui/States";

/** Reads the confirm token from ?token= (contract: GET /newsletter/confirm?token=), strips it from the address bar before paint. */
export function NewsletterConfirm() {
  const t = useTranslations("newsletter");
  const tokenRef = useRef<string | null | undefined>(undefined);
  const [state, setState] = useState<"pending" | "ok" | "bad" | "error">("pending");
  useLayoutEffect(() => {
    const url = new URL(window.location.href);
    tokenRef.current = url.searchParams.get("token");
    if (url.searchParams.has("token")) {
      url.searchParams.delete("token");
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
    }
  }, []);
  useEffect(() => {
    const token = tokenRef.current;
    if (!token || token.length < 32 || token.length > 128) return setState("bad");
    let live = true;
    call("newsletterConfirm", { query: { token } }).then((res) => {
      if (!live) return;
      setState(res.ok ? "ok" : res.status === 400 || res.status === 404 || res.status === 410 ? "bad" : "error");
    });
    return () => { live = false; };
  }, []);
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      {state === "pending" ? <Spinner label={t("confirming")} /> : (
        <>
          <h1 className="text-4xl md:text-5xl">{t(state === "ok" ? "confirmedTitle" : state === "bad" ? "badTitle" : "errorTitle")}</h1>
          <p className="mt-4 text-muted">{t(state === "ok" ? "confirmedBody" : state === "bad" ? "badBody" : "errorBody")}</p>
          <Link href="/journal" className="btn btn-outline mt-8">{t("toJournal")}</Link>
        </>
      )}
    </div>
  );
}
