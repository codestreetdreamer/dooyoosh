/** DEV FIXTURES — NOT PRODUCTION DATA. Shapes: src/contracts/journal.ts. */
import type { ArticleDetail, TipTapNode } from "@/contracts/journal";
import { fixtureProducts, toCard } from "./catalog";

const p = (text: string): TipTapNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const h2 = (text: string): TipTapNode => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
const quote = (text: string): TipTapNode => ({ type: "blockquote", content: [p(text)] });
const cards = (...slugs: string[]) => fixtureProducts.filter((x) => slugs.includes(x.slug)).map(toCard);
const tag = (n: number, slug: string, name: string) => ({ id: `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`, slug, name });

export const fixtureArticles: ArticleDetail[] = [
  {
    id: "00000000-0000-4000-a000-000000000001",
    slug: "the-colour-of-dusk",
    title: "The colour of dusk",
    excerpt: "Why this season's palette began on a rooftop in old Tashkent, an hour before the call to prayer.",
    coverImageUrl: "/placeholders/hero-3.svg",
    authorName: "Editorial team",
    publishedAt: "2026-10-18T09:00:00.000Z",
    tags: [tag(1, "craft", "Craft")],
    seoTitle: null,
    seoDescription: null,
    products: cards("silk-slip-dress", "silk-twill-scarf"),
    body: {
      type: "doc",
      content: [
        p("Every collection starts with a colour. This one started with a single hour: the moment the brick of the old city turns rose and the sky behind it goes the soft grey-brown of milky tea."),
        p("We spent a week photographing that hour and pinned the prints above the cutting table. The dusty rose of our slip dress, the taupe of the wrap coat and the espresso that anchors everything else were all matched by eye against those photographs."),
        quote("We wanted clothes that look as if the light has been resting on them for years."),
        h2("Silk that moves like water"),
        p("The slip dress is cut on the bias from 22 momme sand-washed silk. Heavier than most silk you will find in a slip, it hangs rather than clings, and the washing gives it a matte, almost suede-like hand."),
        p("Wear it alone in September, over a fine knit in October and under the wrap coat when the first frost arrives."),
      ],
    },
  },
  {
    id: "00000000-0000-4000-a000-000000000002",
    slug: "made-to-be-resoled",
    title: "Made to be resoled",
    excerpt: "Inside the workshop where our boots are welted by hand — and why we think a shoe should outlive its first sole.",
    coverImageUrl: "/placeholders/hero-4.svg",
    authorName: "Editorial team",
    publishedAt: "2026-10-10T09:00:00.000Z",
    tags: [tag(2, "footwear", "Footwear")],
    seoTitle: null,
    seoDescription: null,
    products: cards("knee-high-boot", "suede-loafer"),
    body: {
      type: "doc",
      content: [
        p("A Goodyear welt is a strip of leather stitched between the upper and the sole. It takes longer to make, it costs more and almost nobody will ever see it. It is also the reason a good boot can be resoled again and again."),
        h2("Slow by design"),
        p("Each pair of our knee-high boots passes through eleven pairs of hands. The lasts are left in for three days so the leather remembers its shape."),
        quote("The best shoe is the one you are still wearing in ten years."),
        p("When the sole wears through, send them back to us. We will resole them and return them in their original box."),
      ],
    },
  },
  {
    id: "00000000-0000-4000-a000-000000000003",
    slug: "a-capsule-for-travel",
    title: "A capsule for travel",
    excerpt: "Seven pieces, one carry-on, ten days between Samarkand and Bukhara.",
    coverImageUrl: "/placeholders/hero-2.svg",
    authorName: "Editorial team",
    publishedAt: "2026-09-28T09:00:00.000Z",
    tags: [tag(3, "style", "Style")],
    seoTitle: null,
    seoDescription: null,
    products: cards("cotton-poplin-shirt", "pleated-wide-trousers", "structured-tote", "leather-ballet-flat"),
    body: {
      type: "doc",
      content: [
        p("Packing light is an exercise in editing. We set ourselves a rule: everything has to work with everything else, and nothing can need ironing."),
        h2("The pieces"),
        p("A poplin shirt worn open over a slip or buttoned with trousers. Wide trousers that roll into nothing. Flats that survive cobblestones. A tote big enough for a laptop and a melon from the bazaar."),
        p("Ten days later we came home with the same seven pieces — and a suitcase full of ikat."),
      ],
    },
  },
];
