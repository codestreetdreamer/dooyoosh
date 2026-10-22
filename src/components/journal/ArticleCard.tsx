import type { ArticleCard as Card } from "@/contracts/journal";
import { Link } from "@/i18n/navigation";
import { Img } from "@/components/ui/Img";

export function formatDate(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
}

export function ArticleCard({ article, locale, readMore, large = false }: { article: Card; locale: string; readMore: string; large?: boolean }) {
  return (
    <article className="group">
      <Link href={`/journal/${article.slug}`} className="block">
        <div className={`relative overflow-hidden bg-line ${large ? "aspect-[16/10]" : "aspect-[4/3]"}`}>
          <Img
            src={article.coverImageUrl ?? "/placeholders/hero-1.svg"}
            alt=""
            fill
            sizes={large ? "(min-width: 768px) 60vw, 100vw" : "(min-width: 768px) 33vw, 100vw"}
            className="object-cover transition-transform duration-700 group-hover:scale-[1.02]"
          />
        </div>
        <p className="eyebrow mt-5">
          {article.tags[0]?.name ? `${article.tags[0].name} · ` : ""}
          <time dateTime={article.publishedAt}>{formatDate(article.publishedAt, locale)}</time>
        </p>
        <h3 className={`mt-2 ${large ? "text-4xl md:text-5xl" : "text-2xl md:text-3xl"}`}>{article.title}</h3>
        {article.excerpt ? <p className="mt-3 max-w-prose text-muted">{article.excerpt}</p> : null}
        <span className="link-underline mt-4 inline-block text-xs uppercase tracking-[0.18em]">{readMore}</span>
      </Link>
    </article>
  );
}
