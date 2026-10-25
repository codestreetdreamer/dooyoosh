"use client";
import { useEffect } from "react";
import { useTranslations } from "next-intl";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("error");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section role="alert" className="mx-auto max-w-xl px-6 py-28 text-center">
      <h1 className="text-4xl">{t("title")}</h1>
      <p className="mt-4 text-muted">{t("body")}</p>
      <button type="button" onClick={reset} className="btn btn-primary mt-8">{t("retry")}</button>
    </section>
  );
}
