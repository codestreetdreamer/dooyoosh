import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { POLICY_PAGES } from "@/components/pages/policy-content";

type Params = Promise<{ locale: string; slug: string }>;

export function generateStaticParams() {
  return Object.keys(POLICY_PAGES).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const page = POLICY_PAGES[slug];
  return page ? { title: page.title, description: page.intro } : {};
}

export default async function PolicyPage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const page = POLICY_PAGES[slug];
  if (!page) notFound();
  return (
    <article className="mx-auto max-w-3xl px-4 py-14 md:py-20">
      <h1 className="text-5xl md:text-6xl">{page.title}</h1>
      {page.draft ? (
        <p role="note" className="mt-6 border-l-2 border-accent bg-surface px-4 py-3 text-sm text-muted">
          Draft — final wording pending review. Bracketed text marks details still to be confirmed.
        </p>
      ) : null}
      <p className="mt-8 text-lg leading-relaxed">{page.intro}</p>
      {page.sections.map((s) => (
        <section key={s.heading} className="mt-10">
          <h2 className="text-3xl">{s.heading}</h2>
          {s.body.map((b) => <p key={b} className="mt-3 leading-relaxed text-muted">{b}</p>)}
        </section>
      ))}
    </article>
  );
}
