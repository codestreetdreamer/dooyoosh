"use client";
import { useState } from "react";
import type { ProductImage } from "@/contracts/catalog";
import { Img } from "@/components/ui/Img";

export function ProductGallery({ images, name, labels }: { images: ProductImage[]; name: string; labels: { gallery: string; showImage: string } }) {
  const sorted = [...images].sort((a, b) => a.sortOrder - b.sortOrder);
  const [active, setActive] = useState(0);
  const current = sorted[active];
  if (!current) {
    return (
      <div className="relative aspect-[4/5] overflow-hidden bg-line">
        <Img src={null} alt={name} fill priority sizes="(min-width: 1024px) 55vw, 100vw" className="object-cover" />
      </div>
    );
  }
  return (
    <section aria-label={labels.gallery} className="grid gap-3 md:grid-cols-[80px_1fr] md:gap-4">
      <div className="relative order-1 aspect-[4/5] overflow-hidden bg-line md:order-2">
        <Img src={current.url} alt={current.alt || name} fill priority sizes="(min-width: 1024px) 55vw, 100vw" className="object-cover" />
      </div>
      {sorted.length > 1 ? (
        <ul className="order-2 flex gap-3 md:order-1 md:flex-col">
          {sorted.map((img, i) => (
            <li key={img.id}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-label={labels.showImage.replace("{n}", String(i + 1))}
                aria-pressed={i === active}
                className={`relative block aspect-[4/5] w-16 overflow-hidden bg-line md:w-20 ${i === active ? "ring-1 ring-ink ring-offset-2 ring-offset-bg" : "opacity-70 hover:opacity-100"}`}
              >
                <Img src={img.url} alt="" fill sizes="80px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
