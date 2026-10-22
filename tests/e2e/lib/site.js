import { test } from "@playwright/test";
export const SITE_URL = (process.env.SITE_URL || "http://localhost:3000").replace(/\/$/, "");
export const API = `${SITE_URL}/api/v1`;
export const LOCALES = (process.env.QA_LOCALES || "en").split(",").map((s) => s.trim()).filter(Boolean);

let up;
export async function siteUp() {
  if (up !== undefined) return up;
  try { await fetch(SITE_URL, { signal: AbortSignal.timeout(3000) }); up = true; } catch { up = false; }
  return up;
}
/** call at top of a describe: skips everything when the app is not running */
export function requireSite() {
  test.beforeAll(async () => { test.skip(!(await siteUp()), `app not reachable at ${SITE_URL} (run \`pnpm build && pnpm start\` or set SITE_URL)`); });
}
async function j(path) { try { const r = await fetch(API + path); return r.ok ? await r.json() : null; } catch { return null; } }
export async function firstProductSlug() { return process.env.QA_PRODUCT_SLUG || (await j("/products?limit=1"))?.data?.[0]?.slug; }
export async function firstArticleSlug() { return process.env.QA_ARTICLE_SLUG || (await j("/articles?limit=1"))?.data?.[0]?.slug; }

/** Collects console errors, page errors and failed/4xx-5xx same-origin requests. */
export function watch(page, { allowStatus = [] } = {}) {
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => { const f = r.failure()?.errorText || ""; if (!/ERR_ABORTED/.test(f)) problems.push(`requestfailed: ${r.url()} ${f}`); });
  page.on("response", (r) => {
    if (r.url().startsWith(SITE_URL) && r.status() >= 400 && !allowStatus.includes(r.status()) && r.request().resourceType() !== "document") problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  return problems;
}
export async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); return r.right > w + 1 && getComputedStyle(el).position !== "fixed"; })
      .slice(0, 5).map((el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${[...el.classList].slice(0, 2).join(".")}`);
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: w, offenders };
  });
}
/** UZS display format from src/lib/money.ts: "1 250 000 so’m" (thin/nbsp/space separators, ’ or ') */
export const UZS_RE = /\d{1,3}(?:[\s\u00a0\u202f]\d{3})*[\s\u00a0\u202f]so[’'ʻ`]m/;
