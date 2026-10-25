/**
 * DEV FIXTURES — NOT PRODUCTION DATA. Used only behind NEXT_PUBLIC_USE_FIXTURES (see src/lib/store/data-source.ts).
 * Shapes: src/contracts/catalog.ts. Public data exposes availability only (no stock counts).
 */
import type { CategoryNode, ProductCard, ProductDetail, ProductImage, PublicVariant } from "@/contracts/catalog";

export const FIXTURE_CURRENCY = "UZS";
const so = (n: number) => n * 100; // whole so'm -> tiyin (minor units)

let seq = 0;
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export const fixtureCategories: CategoryNode[] = [
  { id: id(), slug: "clothing", kind: "clothing", name: "Clothing", description: "Tailoring, dresses and knitwear cut in small runs.", sortOrder: 1, children: [] },
  { id: id(), slug: "footwear", kind: "footwear", name: "Footwear", description: "Leather shoes and boots made to be resoled.", sortOrder: 2, children: [] },
  { id: id(), slug: "accessories", kind: "accessories", name: "Accessories", description: "Bags, silk and jewellery to finish a look.", sortOrder: 3, children: [] },
];

type Seed = {
  slug: string;
  name: string;
  category: "clothing" | "footwear" | "accessories";
  price: number; // so'm
  shape: string;
  tone: number;
  publishedDaysAgo: number;
  description: string;
  materials: string;
  care: string;
  fitNotes: string | null;
  sizes: string[] | null;
  colours: { name: string; hex: string }[];
  soldOut?: string[]; // "size|colour" keys that are unavailable
  sizeSystem: ProductDetail["sizeSystem"];
};

const seeds: Seed[] = [
  { slug: "silk-slip-dress", name: "Silk Slip Dress", category: "clothing", price: 2_450_000, shape: "dress", tone: 3, publishedDaysAgo: 2,
    description: "A bias-cut slip in heavy sand-washed silk that moves like water. Adjustable straps, a low cowl back and a hem that skims the ankle.",
    materials: "100% mulberry silk, 22 momme", care: "Dry clean or cold hand wash. Dry flat in shade.", fitNotes: "True to size. Model is 176 cm and wears S.",
    sizes: ["XS", "S", "M", "L"], colours: [{ name: "Dusty Rose", hex: "#B08A85" }, { name: "Espresso", hex: "#4A3931" }], soldOut: ["XS|Dusty Rose", "L|Espresso"], sizeSystem: "alpha" },
  { slug: "wool-wrap-coat", name: "Wool Wrap Coat", category: "clothing", price: 4_900_000, shape: "coat", tone: 2, publishedDaysAgo: 5,
    description: "An unlined wrap coat in double-faced wool with dropped shoulders and a long self-tie belt.",
    materials: "90% wool, 10% cashmere", care: "Dry clean only.", fitNotes: "Relaxed fit — size down for a closer silhouette.",
    sizes: ["S", "M", "L"], colours: [{ name: "Taupe", hex: "#BFA99C" }, { name: "Camel", hex: "#B58B5E" }], sizeSystem: "alpha" },
  { slug: "pleated-wide-trousers", name: "Pleated Wide Trousers", category: "clothing", price: 1_650_000, shape: "trousers", tone: 4, publishedDaysAgo: 9,
    description: "High-rise trousers with double front pleats and a fluid wide leg, finished with a hidden hook closure.",
    materials: "Wool crepe", care: "Dry clean.", fitNotes: "High rise. Inseam 82 cm on size 36.",
    sizes: ["34", "36", "38", "40"], colours: [{ name: "Espresso", hex: "#4A3931" }], soldOut: ["34|Espresso"], sizeSystem: "numeric" },
  { slug: "cotton-poplin-shirt", name: "Cotton Poplin Shirt", category: "clothing", price: 980_000, shape: "top", tone: 1, publishedDaysAgo: 14,
    description: "An oversized shirt in crisp Uzbek-grown cotton poplin with a deep back pleat and mother-of-pearl buttons.",
    materials: "100% cotton poplin", care: "Machine wash 30°C.", fitNotes: "Oversized. Take your usual size.",
    sizes: ["XS", "S", "M", "L"], colours: [{ name: "Ivory", hex: "#F3EDE4" }, { name: "Dusty Rose", hex: "#B08A85" }], sizeSystem: "alpha" },
  { slug: "ikat-midi-skirt", name: "Ikat Midi Skirt", category: "clothing", price: 1_850_000, shape: "dress", tone: 1, publishedDaysAgo: 30,
    description: "A softly gathered midi skirt in hand-woven adras ikat from the Fergana Valley.",
    materials: "Silk and cotton adras", care: "Dry clean.", fitNotes: "Elasticated back waist.",
    sizes: ["S", "M"], colours: [{ name: "Rose Ikat", hex: "#A87C78" }], soldOut: ["S|Rose Ikat", "M|Rose Ikat"], sizeSystem: "alpha" },
  { slug: "leather-ballet-flat", name: "Leather Ballet Flat", category: "footwear", price: 1_400_000, shape: "shoe", tone: 3, publishedDaysAgo: 3,
    description: "A square-toe ballet flat in supple nappa with a whisper-thin leather sole and cushioned insole.",
    materials: "Nappa leather upper and lining, leather sole", care: "Wipe clean; use a neutral cream.", fitNotes: "True to size.",
    sizes: ["36", "37", "38", "39", "40"], colours: [{ name: "Espresso", hex: "#4A3931" }, { name: "Blush", hex: "#D9B8B1" }], soldOut: ["36|Blush", "40|Espresso"], sizeSystem: "eu_shoe" },
  { slug: "knee-high-boot", name: "Knee-High Boot", category: "footwear", price: 3_200_000, shape: "boot", tone: 4, publishedDaysAgo: 7,
    description: "A slim knee-high boot on a stacked 50 mm heel, with an inside zip and a Goodyear-welted sole.",
    materials: "Calf leather, leather sole with rubber insert", care: "Polish regularly. Store with boot trees.", fitNotes: "Narrow calf — size up if between sizes.",
    sizes: ["37", "38", "39"], colours: [{ name: "Espresso", hex: "#4A3931" }], sizeSystem: "eu_shoe" },
  { slug: "suede-loafer", name: "Suede Loafer", category: "footwear", price: 1_950_000, shape: "shoe", tone: 2, publishedDaysAgo: 21,
    description: "A soft unstructured loafer in brushed suede with a hand-stitched apron toe.",
    materials: "Suede upper, leather lining", care: "Brush with a suede brush.", fitNotes: "True to size.",
    sizes: ["38", "39", "40", "41"], colours: [{ name: "Taupe", hex: "#BFA99C" }], soldOut: ["41|Taupe"], sizeSystem: "eu_shoe" },
  { slug: "structured-tote", name: "Structured Tote", category: "accessories", price: 2_750_000, shape: "bag", tone: 1, publishedDaysAgo: 1,
    description: "A clean-lined tote in vegetable-tanned leather that softens with use. Fits a 14\" laptop.",
    materials: "Vegetable-tanned leather, cotton lining", care: "Condition twice a year.", fitNotes: null,
    sizes: null, colours: [{ name: "Espresso", hex: "#4A3931" }, { name: "Taupe", hex: "#BFA99C" }], soldOut: ["|Taupe"], sizeSystem: "one_size" },
  { slug: "silk-twill-scarf", name: "Silk Twill Scarf", category: "accessories", price: 850_000, shape: "scarf", tone: 3, publishedDaysAgo: 4,
    description: "A 90 cm square in silk twill, printed with a suzani motif and hand-rolled at the edges.",
    materials: "100% silk twill", care: "Dry clean.", fitNotes: null,
    sizes: null, colours: [{ name: "Rose Suzani", hex: "#B08A85" }], sizeSystem: "one_size" },
  { slug: "gold-hoop-earrings", name: "Gold Hoop Earrings", category: "accessories", price: 1_200_000, shape: "jewel", tone: 2, publishedDaysAgo: 12,
    description: "Hollow hoops in 18k gold vermeil — light enough to wear all day.",
    materials: "18k gold vermeil on sterling silver", care: "Keep dry. Polish with a soft cloth.", fitNotes: null,
    sizes: null, colours: [{ name: "Gold", hex: "#C9A46A" }], soldOut: ["|Gold"], sizeSystem: "one_size" },
  { slug: "leather-belt", name: "Leather Belt", category: "accessories", price: 690_000, shape: "bag", tone: 4, publishedDaysAgo: 40,
    description: "A narrow belt in bridle leather with a brushed brass buckle.",
    materials: "Bridle leather, brass", care: "Condition occasionally.", fitNotes: "Sizes are waist measurements in cm.",
    sizes: ["70", "80", "90"], colours: [{ name: "Espresso", hex: "#4A3931" }], sizeSystem: "numeric" },
];

const NOW = Date.UTC(2026, 9, 22);

function build(seed: Seed): ProductDetail {
  const productId = id();
  const currency = FIXTURE_CURRENCY;
  const variants: PublicVariant[] = [];
  const sizes = seed.sizes ?? [null];
  let n = 0;
  for (const c of seed.colours) {
    for (const s of sizes) {
      n++;
      const key = `${s ?? ""}|${c.name}`;
      variants.push({
        id: id(),
        sku: `DEMO-${seed.slug.toUpperCase().slice(0, 12)}-${n}`,
        size: s,
        colour: c.name,
        colourHex: c.hex,
        priceMinor: so(seed.price),
        currency,
        available: !(seed.soldOut ?? []).includes(key),
      });
    }
  }
  const images: ProductImage[] = [1, 2, 3].map((k, i) => ({
    id: id(),
    variantId: null,
    url: `/placeholders/${seed.shape}-${((seed.tone + i - 1) % 4) + 1}.svg`,
    alt: `${seed.name} — placeholder image ${k} of 3`,
    width: 450,
    height: 560,
    sortOrder: i,
  }));
  return {
    id: productId,
    slug: seed.slug,
    name: seed.name,
    brand: "Dooyoosh",
    categorySlug: seed.category,
    priceFromMinor: so(seed.price),
    currency,
    image: images[0] ?? null,
    available: variants.some((v) => v.available),
    publishedAt: new Date(NOW - seed.publishedDaysAgo * 86_400_000).toISOString(),
    description: seed.description,
    materials: seed.materials,
    care: seed.care,
    fitNotes: seed.fitNotes,
    seoTitle: null,
    seoDescription: null,
    sizeSystem: seed.sizeSystem,
    sizeChart: null,
    images,
    variants,
  };
}

export const fixtureProducts: ProductDetail[] = seeds.map(build);

export function toCard(p: ProductDetail): ProductCard {
  return {
    id: p.id, slug: p.slug, name: p.name, brand: p.brand, categorySlug: p.categorySlug,
    priceFromMinor: p.priceFromMinor, currency: p.currency, image: p.image, available: p.available, publishedAt: p.publishedAt,
  };
}
