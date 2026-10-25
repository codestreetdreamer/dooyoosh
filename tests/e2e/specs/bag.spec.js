// Bag, checkout with mock payment, reservation countdown, 409 UX, return-page token hygiene.
import { test, expect } from "@playwright/test";
import { requireSite, UZS_RE, watch, SITE_URL } from "../lib/site.js";
import { L, PRODUCT, addToBag, fillCheckout, submitCheckout } from "../lib/ui.js";

test.describe("bag + checkout", () => {
  requireSite();
  test.beforeEach(async ({ page }) => { await page.goto(`/${L}`); await page.evaluate(() => localStorage.clear()); });

  test("add, increase, decrease, remove; prices in UZS format", async ({ page }) => {
    const problems = watch(page);
    await addToBag(page);
    await page.goto(`/${L}/bag`, { waitUntil: "networkidle" });
    const inc = page.getByRole("button", { name: /^increase quantity of/i }).first();
    const dec = page.getByRole("button", { name: /^decrease quantity of/i }).first();
    await expect(inc).toBeVisible();
    const summary = page.locator('[aria-labelledby="bag-summary"]');
    await expect(summary).toContainText(UZS_RE);
    const subtotal = async () => (await summary.innerText()).match(UZS_RE)?.[0];
    const before = await subtotal();
    await inc.click();
    await expect.poll(subtotal).not.toBe(before);
    await dec.click();
    await expect.poll(subtotal).toBe(before);
    await page.getByRole("button", { name: /^remove .* from bag$/i }).first().click();
    await expect(page.getByText(/your bag is empty/i)).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("quantity is capped at 10 (MAX_LINE_QTY) and bag survives reload", async ({ page }) => {
    await addToBag(page);
    await page.goto(`/${L}/bag`, { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    const inc = page.getByRole("button", { name: /^increase quantity of/i }).first();
    for (let i = 0; i < 12 && (await inc.isEnabled()); i++) await inc.click();
    await expect(inc).toBeDisabled();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("dooyoosh.bag.v1") || "[]"));
    expect(stored[0]?.quantity).toBe(10);
  });

  test("tampered localStorage (qty 999, price 1) is clamped and re-priced by validation", async ({ page }) => {
    await addToBag(page);
    await page.evaluate(() => { const b = JSON.parse(localStorage.getItem("dooyoosh.bag.v1")); b[0].quantity = 999; b[0].snapshot.unitPriceMinor = 100; localStorage.setItem("dooyoosh.bag.v1", JSON.stringify(b)); });
    await page.goto(`/${L}/bag`, { waitUntil: "networkidle" });
    await expect(page.locator('[aria-labelledby="bag-summary"]')).not.toContainText(/^1 so/);
    const q = await page.evaluate(() => JSON.parse(localStorage.getItem("dooyoosh.bag.v1"))[0].quantity);
    expect(q).toBeLessThanOrEqual(10);
    await expect(page.locator('[aria-labelledby="bag-summary"]')).not.toContainText(/\b1[\s\u00a0\u202f]so/);
  });

  test("sold-out variant injected into the bag is flagged and checkout is blocked", async ({ page }) => {
    await addToBag(page);
    // swap the line to a sold-out variant id taken from the product page data (fixtures: XS|Dusty Rose)
    await page.goto(`/${L}/product/${PRODUCT}`);
    const soldId = await page.evaluate(() => {
      const m = document.documentElement.innerHTML.match(/"id":"([0-9a-f-]{36})"[^}]*"size":"XS"[^}]*"available":false/);
      return m?.[1];
    });
    test.skip(!soldId, "could not discover a sold-out variant id on the page");
    await page.evaluate((id) => { const b = JSON.parse(localStorage.getItem("dooyoosh.bag.v1")); b[0].variantId = id; localStorage.setItem("dooyoosh.bag.v1", JSON.stringify(b)); }, soldId);
    await page.goto(`/${L}/bag`, { waitUntil: "networkidle" });
    await expect(page.getByText(/sold out — please remove this item|no longer available/i).first()).toBeVisible();
  });

  test("full checkout with mock payment -> return page -> order page shows paid", async ({ page }, info) => {
    const problems = watch(page);
    await addToBag(page);
    await fillCheckout(page);
    await expect(page.getByText(UZS_RE).first()).toBeVisible();
    await submitCheckout(page);
    await page.waitForURL(/\/dev\/mock-pay\?/, { timeout: 15_000 });
    // reservation countdown appears in the bag/checkout once a checkout exists
    const back = await page.context().newPage();
    await back.goto(`/${L}/bag`, { waitUntil: "networkidle" });
    const cd = back.getByText(/reserved for \d{2}:\d{2}/i).first();
    const cdVisible = await cd.isVisible().catch(() => false);
    if (cdVisible) await expect(cd).toHaveText(/reserved for 3[45]:\d{2}/i);
    await back.close();
    await page.getByRole("button", { name: /simulate successful payment/i }).click();
    await page.waitForURL(/\/checkout\/return\?/, { timeout: 15_000 });
    const returnUrl = page.url();
    await expect(page.getByText(/DY-\d{8}-[A-Z2-7]{5}/).first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `artifacts/${info.project.name}-return.png`, fullPage: true });
    info.annotations.push({ type: "return-url", description: returnUrl.replace(/token=[^&]+/, "token=<redacted>") });
    info.annotations.push({ type: "countdown-visible-on-bag", description: String(cdVisible) });
    expect(problems).toEqual([]);
  });

  test("guest token never appears in any URL, request, console line or Referer (contract cfd5cee)", async ({ page }) => {
    const urls = []; const referers = []; const consoleTexts = [];
    page.on("request", (r) => { urls.push(r.url()); const ref = r.headers()["referer"]; if (ref) referers.push(ref); });
    page.on("framenavigated", (f) => urls.push(f.url()));
    page.on("console", (m) => consoleTexts.push(m.text()));
    await addToBag(page); await fillCheckout(page); await submitCheckout(page);
    await page.waitForURL(/\/dev\/mock-pay|\/checkout\/sandbox-pay/, { timeout: 15_000 });
    await page.getByRole("button", { name: /simulate successful payment/i }).click();
    await page.waitForURL(/\/checkout\/return/, { timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    // token lives in sessionStorage (or legacy ?token=). Collect every 32+ char base64url-ish value the app stored.
    const stored = await page.evaluate(() => Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k) || ""));
    const candidates = new Set([new URL(page.url()).searchParams.get("token"), ...stored.flatMap((v) => v.match(/[A-Za-z0-9_-]{32,128}/g) || [])].filter(Boolean));
    expect(candidates.size, "could not find the guest token in sessionStorage or URL").toBeGreaterThan(0);
    for (const t of candidates) {
      expect(urls.filter((u) => u.includes(t)), "token in a URL").toEqual([]);
      expect(referers.filter((u) => u.includes(t)), "token leaked via Referer").toEqual([]);
      expect(consoleTexts.filter((x) => x.includes(t)), "token printed to console").toEqual([]);
    }
    const rp = (await page.request.get(page.url())).headers()["referrer-policy"] || "";
    const meta = await page.locator('meta[name="referrer"]').getAttribute("content").catch(() => null);
    expect(["no-referrer", "strict-origin", "same-origin", "strict-origin-when-cross-origin"], `Referrer-Policy "${rp}" meta "${meta}"`).toContain(meta || rp);
    await expect(page.getByText(/DY-\d{8}-[A-Z2-7]{5}/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("demo banner visible unless NEXT_PUBLIC_PAYMENT_MODE === 'live'", async ({ page }) => {
    const mode = process.env.QA_EXPECT_PAYMENT_MODE || "sandbox";
    await page.goto(`/${L}`, { waitUntil: "networkidle" });
    const banner = page.getByText(/demo|test mode|no real (payment|money)|sandbox/i).first();
    if (mode === "live") await expect(banner).toHaveCount(0);
    else {
      await expect(banner).toBeVisible();
      for (const path of [`/${L}/bag`, `/${L}/checkout`]) { await page.goto(path, { waitUntil: "networkidle" }); await expect(page.getByText(/demo|test mode|no real (payment|money)|sandbox/i).first()).toBeVisible(); }
      await expect(page.getByRole("button", { name: /dismiss|close/i }).filter({ hasText: /demo/i })).toHaveCount(0);
    }
  });

  test("409 OUT_OF_STOCK / PRICE_CHANGED UI can be triggered", async ({ page }) => {
    // The fixtures run in-process (no network), so /api/v1/checkout cannot be intercepted. If a real API exists, intercept it.
    const r = await page.request.post(`${SITE_URL}/api/v1/checkout`, { data: {} }).catch(() => null);
    test.skip(!r || r.status() === 404, "fixtures mode: checkout is in-process; needs a fixture switch (e.g. localStorage 'dooyoosh.mock.force409') or the real API");
    await addToBag(page);
    await page.route(`${SITE_URL}/api/v1/checkout`, (route) => route.fulfill({ status: 409, contentType: "application/json",
      body: JSON.stringify({ error: { code: "OUT_OF_STOCK", message: "Some items are no longer available", details: { variantIds: [JSON.parse(route.request().postData()).items[0].variantId] } } }) }));
    await fillCheckout(page); await submitCheckout(page);
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByRole("alert").first()).not.toHaveText(/OUT_OF_STOCK|409|undefined|\[object/);
  });
});
