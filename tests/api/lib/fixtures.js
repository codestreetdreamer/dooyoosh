// Discovers a buyable variant + shipping method through the public API (or env overrides). Returns null if none.
import { call, env } from "./http.js";

export async function buyable() {
  const country = env("QA_COUNTRY") || "UZ";
  let variant = env("QA_VARIANT_ID"), price, currency;
  if (!variant) {
    const list = await call("GET", "/products", { query: { limit: 24 } });
    for (const card of list.json?.data || []) {
      const d = await call("GET", `/products/${card.slug}`);
      const v = (d.json?.data?.variants || []).find((x) => x.available);
      if (v) { variant = v.id; price = v.priceMinor; currency = v.currency ?? d.json.data.currency; break; }
    }
  }
  if (!variant) return null;
  const ship = await call("GET", "/shipping/options", { query: { country } });
  const method = env("QA_SHIPPING_METHOD_ID") || ship.json?.data?.[0]?.id || ship.json?.data?.methods?.[0]?.id;
  if (!method) return null;
  return { variantId: variant, priceMinor: price, currency, shippingMethodId: method, country };
}

export function checkoutBody(f, over = {}) {
  return {
    email: "qa+checkout@dooyoosh.test",
    locale: "uz",
    items: [{ variantId: f.variantId, quantity: 1 }],
    shippingAddress: { fullName: "QA Tester", line1: "Amir Temur 1", city: "Tashkent", country: f.country },
    shippingMethodId: f.shippingMethodId,
    ...over,
  };
}
