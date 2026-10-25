/**
 * Static page copy (English). DRAFT TEXT — legal pages (privacy, terms, returns, cookies) await Mirfozil's
 * final content and legal review (DEPLOY_READINESS: "Legal pages content ❌"). Do not treat as legal advice.
 */
export type PolicyPage = { title: string; intro: string; draft: boolean; sections: { heading: string; body: string[] }[] };

export const POLICY_PAGES: Record<string, PolicyPage> = {
  about: {
    title: "About Dooyoosh", draft: false,
    intro: "Dooyoosh is a fashion house based in Uzbekistan, making clothing, footwear and accessories in small runs.",
    sections: [
      { heading: "What we make", body: ["We own every piece we sell. Each collection is designed in Tashkent and produced in limited quantities with workshops we know by name."] },
      { heading: "The journal", body: ["Our journal tells the stories behind the pieces: the cloth, the craft and the people who make them."] },
    ],
  },
  shipping: {
    title: "Shipping", draft: true,
    intro: "Delivery options, costs and timings are shown at checkout for your country and are confirmed by our server before payment.",
    sections: [
      { heading: "Where we ship", body: ["We ship within Uzbekistan and to selected international destinations. If your country is not offered at checkout we cannot ship there yet."] },
      { heading: "Delivery times", body: ["Estimated delivery times are shown per delivery method at checkout. Orders are dispatched once payment is confirmed by the payment provider."] },
      { heading: "Duties and taxes", body: ["International orders may be subject to import duties and taxes charged by the destination country. [Final wording pending.]"] },
      { heading: "Tracking", body: ["When your order ships we email you a tracking link. You can also view the status from the link in your confirmation email."] },
    ],
  },
  returns: {
    title: "Returns & exchanges", draft: true,
    intro: "If something is not right, you can return unworn items in their original condition. [Return window and process pending final policy.]",
    sections: [
      { heading: "How to return", body: ["Contact us with your order reference. We will send return instructions."] },
      { heading: "Refunds", body: ["Refunds are issued to the original payment method once the return has been received and inspected. If an item sells out while you are paying, your payment is refunded automatically."] },
    ],
  },
  "size-guide": {
    title: "Size guide", draft: false,
    intro: "Each product page lists fit notes. If you are between sizes, the fit notes tell you whether to size up or down.",
    sections: [
      { heading: "Clothing (alpha sizes)", body: ["XS — bust 80–83 cm, waist 62–65 cm", "S — bust 84–87 cm, waist 66–69 cm", "M — bust 88–92 cm, waist 70–74 cm", "L — bust 93–97 cm, waist 75–79 cm"] },
      { heading: "Footwear (EU sizes)", body: ["36 — 23.0 cm · 37 — 23.7 cm · 38 — 24.3 cm · 39 — 25.0 cm · 40 — 25.7 cm · 41 — 26.3 cm (foot length)"] },
    ],
  },
  privacy: {
    title: "Privacy policy", draft: true,
    intro: "This draft explains what personal data we collect when you shop with us and why. It is pending legal review under the Law of the Republic of Uzbekistan on Personal Data.",
    sections: [
      { heading: "What we collect", body: ["Your email, phone number (optional), shipping address and order details — only what we need to fulfil your order. We never see or store your card details; payments are processed by the payment provider."] },
      { heading: "How we use it", body: ["To process and deliver your order, to send order updates and, only if you opt in, our newsletter."] },
      { heading: "Your rights", body: ["You can ask us to access, correct or delete your personal data. [Contact details and data-controller information pending.]"] },
    ],
  },
  terms: {
    title: "Terms of sale", draft: true,
    intro: "These draft terms apply to purchases from Dooyoosh. Final terms are pending legal review.",
    sections: [
      { heading: "Prices", body: ["Prices are shown in the store currency and confirmed by our server at checkout. Your order is accepted only once the payment provider confirms payment."] },
      { heading: "Availability", body: ["Items are reserved for 35 minutes once you continue to payment. If an item becomes unavailable we will refund you in full."] },
    ],
  },
  cookies: {
    title: "Cookies", draft: true,
    intro: "We use only the storage needed for the shop to work: your bag is kept in your browser's local storage. We do not use advertising cookies. [Analytics decision pending.]",
    sections: [],
  },
  contact: {
    title: "Contact", draft: true,
    intro: "Questions about an order, sizing or a piece you love? We are happy to help.",
    sections: [{ heading: "Customer care", body: ["[Email address, phone and opening hours pending from Mirfozil.]"] }],
  },
};
