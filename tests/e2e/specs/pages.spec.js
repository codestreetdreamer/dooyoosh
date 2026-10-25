// Every page in ARCHITECTURE §6 on every viewport: loads, no console errors / failed requests, no horizontal overflow, axe clean.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { requireSite, watch, horizontalOverflow, firstProductSlug, firstArticleSlug, LOCALES } from "../lib/site.js";

const STATIC_PAGES = ["about", "shipping", "returns", "size-guide", "privacy", "terms", "cookies", "contact"];

test.describe("§6 pages", () => {
  requireSite();
  let product, article;
  test.beforeAll(async () => { product = await firstProductSlug(); article = await firstArticleSlug(); });

  for (const L of LOCALES) {
    const pages = [
      ["home", `/${L}`], ["shop", `/${L}/shop`],
      ["shop/clothing", `/${L}/shop/clothing`], ["shop/footwear", `/${L}/shop/footwear`], ["shop/accessories", `/${L}/shop/accessories`],
      ["product", () => product && `/${L}/product/${product}`], ["bag", `/${L}/bag`], ["checkout", `/${L}/checkout`],
      ["journal", `/${L}/journal`], ["article", () => article && `/${L}/journal/${article}`],
      ...STATIC_PAGES.map((s) => [`pages/${s}`, `/${L}/pages/${s}`]),
    ];
    for (const [name, p] of pages) {
      test(`${L} ${name}`, async ({ page }) => {
        const url = typeof p === "function" ? p() : p;
        test.skip(!url, `${name}: no published item found via API (seed data or set QA_PRODUCT_SLUG / QA_ARTICLE_SLUG)`);
        const problems = watch(page);
        const res = await page.goto(url, { waitUntil: "networkidle" });
        expect(res?.status(), `${url} status`).toBeLessThan(400);
        await expect(page.locator("main, [role=main]").first(), "page has a <main> landmark").toBeVisible();
        await expect(page).toHaveTitle(/\S/);
        expect(await page.locator("html").getAttribute("lang"), "html[lang] matches locale").toBe(L);
        const o = await horizontalOverflow(page);
        expect(o.scrollWidth, `horizontal overflow; widest: ${o.offenders.join(", ")}`).toBeLessThanOrEqual(o.clientWidth + 1);
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        const bad = axe.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target}`);
        expect(bad, "axe serious/critical").toEqual([]);
        expect(problems).toEqual([]);
      });
    }
  }

  test("order page with a wrong token shows a not-found state, not a crash or order data", async ({ page }) => {
    const problems = watch(page, { allowStatus: [404] });
    const res = await page.goto(`/${LOCALES[0]}/order/DY-20261022-AAAAA?token=${"q".repeat(40)}`);
    expect([200, 404]).toContain(res?.status());
    await expect(page.getByText(/DY-20261022-AAAAA.*(paid|to'langan|оплачен)/i)).toHaveCount(0);
    expect(problems.filter((x) => !/404/.test(x))).toEqual([]);
  });

  test("/admin redirects or 401s when not signed in (no admin UI for anonymous users)", async ({ page }) => {
    const res = await page.goto("/admin");
    const finalUrl = page.url();
    expect(res?.status() === 401 || res?.status() === 403 || /login|sign-?in|auth/.test(finalUrl) || res?.status() === 404).toBe(true);
  });

  test("unknown locale and unknown page -> 404, not 500", async ({ page }) => {
    for (const u of ["/xx/shop", `/${LOCALES[0]}/pages/does-not-exist`, `/${LOCALES[0]}/product/does-not-exist-qa`]) {
      const res = await page.goto(u);
      expect(res?.status(), u).toBe(404);
    }
  });
});
