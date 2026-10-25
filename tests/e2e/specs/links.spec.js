// Broken-link crawl (same origin), desktop only.
import { test, expect } from "@playwright/test";
import { requireSite, SITE_URL, LOCALES } from "../lib/site.js";

test.describe("broken links", () => {
  requireSite();
  test("crawl from each locale home: every same-origin link and image < 400", async ({ page }, info) => {
    test.skip(info.project.name !== "laptop-1280", "runs once");
    test.setTimeout(240_000);
    const MAX = Number(process.env.QA_CRAWL_MAX || 150);
    const seen = new Set(), checked = new Map(), queue = LOCALES.map((l) => `${SITE_URL}/${l}`);
    while (queue.length && seen.size < MAX) {
      const url = queue.shift(); if (seen.has(url)) continue; seen.add(url);
      const res = await page.goto(url).catch(() => null);
      checked.set(url, res?.status() ?? 0);
      if (!res || res.status() >= 400) continue;
      const refs = await page.$$eval("a[href], img[src], link[rel=stylesheet][href]", (els) => els.map((e) => e.href || e.src));
      for (const h of refs) {
        let u; try { u = new URL(h); } catch { continue; }
        if (u.origin !== SITE_URL || /^\/(api|_next\/data)/.test(u.pathname)) continue;
        u.hash = ""; const s = u.toString();
        if (/\.(png|jpe?g|webp|avif|svg|css|ico)(\?|$)/.test(u.pathname) || u.pathname.startsWith("/_next/image")) {
          if (!checked.has(s)) checked.set(s, (await page.request.get(s).catch(() => null))?.status() ?? 0);
        } else if (!seen.has(s)) queue.push(s);
      }
    }
    const broken = [...checked].filter(([, st]) => st === 0 || st >= 400).map(([u, st]) => `${st} ${u}`);
    expect(broken).toEqual([]);
  });
});
