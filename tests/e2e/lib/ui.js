// Drives the storefront through accessible names (en) with data-testid preferred when present.
import { expect } from "@playwright/test";
export const L = (process.env.QA_LOCALES || "en").split(",")[0].trim();
export const PRODUCT = process.env.QA_PRODUCT_SLUG || "silk-slip-dress";

export async function addToBag(page, slug = PRODUCT, { pick = "available" } = {}) {
  await page.goto(`/${L}/product/${slug}`, { waitUntil: "networkidle" });
  // colour first (may already be selected), then first available size
  const colour = page.locator('fieldset:has(legend:has-text("Colour")) input:not([disabled])').first();
  if (await colour.count()) await colour.check({ force: true }).catch(() => {});
  const sizes = page.locator('fieldset:has(legend:has-text("Size")) input');
  const n = await sizes.count();
  for (let i = 0; i < n; i++) {
    const s = sizes.nth(i);
    const label = (await s.getAttribute("aria-label")) || "";
    const sold = /sold out/i.test(label);
    if ((pick === "available" && !sold && (await s.isEnabled())) || (pick === "soldout" && sold)) { await s.check({ force: true }); break; }
  }
  await page.getByTestId("add-to-bag").or(page.getByRole("button", { name: /^add to bag$/i })).first().click();
  await expect(page.getByText(/added to your bag/i)).toBeVisible();
}

export async function fillCheckout(page, { country = "UZ" } = {}) {
  await page.goto(`/${L}/checkout`, { waitUntil: "networkidle" });
  await page.getByLabel(/^email/i).fill("qa@dooyoosh.test");
  await page.getByLabel(/^full name/i).fill("QA Tester");
  await page.getByLabel(/^address$/i).fill("Amir Temur 1");
  await page.getByLabel(/^city$/i).fill("Tashkent");
  await page.getByLabel(/^country$/i).selectOption(country);
  const radio = page.locator('input[type=radio][name="shippingMethod"]').first();
  await radio.waitFor({ timeout: 10_000 }).catch(() => {});
  if (await radio.count()) await radio.check();
}
export const submitCheckout = (page) => page.getByTestId("checkout-submit").or(page.getByRole("button", { name: /continue to payment/i })).first().click();
