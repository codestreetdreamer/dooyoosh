import type { ProductCard as Card } from "@/contracts/catalog";
import { Link } from "@/i18n/navigation";
import { Img } from "@/components/ui/Img";
import { Price } from "./Price";

export function ProductCard({ product, locale, labels, priority = false, sizes = "(min-width: 1024px) 25vw, 50vw" }: {
  product: Card;
  locale: string;
  labels: { soldOut: string };
  priority?: boolean;
  sizes?: string;
}) {
  return (
    <article className="group relative">
      <Link href={`/product/${product.slug}`} className="block">
        <div className="relative aspect-[4/5] overflow-hidden bg-line">
          {product.image ? (
            <Img
              src={product.image.url}
              alt={product.image.alt || product.name}
              fill
              sizes={sizes}
              priority={priority}
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
            />
          ) : null}
          {!product.available ? (
            <span className="absolute left-3 top-3 bg-surface px-2.5 py-1 text-[0.68rem] uppercase tracking-[0.16em]">{labels.soldOut}</span>
          ) : null}
        </div>
        <div className="mt-3 flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-3">
          <h3 className="font-sans text-sm tracking-wide">{product.name}</h3>
          <Price amountMinor={product.priceFromMinor} currency={product.currency} locale={locale} className="text-sm text-muted" />
        </div>
      </Link>
    </article>
  );
}

export function ProductGrid({ products, locale, labels, priorityCount = 0 }: {
  products: Card[]; locale: string; labels: { soldOut: string }; priorityCount?: number;
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4">
      {products.map((p, i) => (
        <li key={p.id}>
          <ProductCard product={p} locale={locale} labels={labels} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
