// QA e2e. Runs against a running app (SITE_URL, default http://localhost:3000). Every spec skips if it is down.
import { defineConfig, devices } from "@playwright/test";

const SITE_URL = (process.env.SITE_URL || "http://localhost:3000").replace(/\/$/, "");
const vp = (name, width, height, extra = {}) => ({ name, use: { ...devices["Desktop Chrome"], viewport: { width, height }, ...extra } });

export default defineConfig({
  testDir: "./specs",
  timeout: 45_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  outputDir: "artifacts/results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "artifacts/report" }]],
  use: { baseURL: SITE_URL, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "uz-UZ", timezoneId: "Asia/Tashkent" },
  projects: [
    vp("mobile-375", 375, 812, { isMobile: true, hasTouch: true, deviceScaleFactor: 3 }),
    vp("tablet-768", 768, 1024, { hasTouch: true }),
    vp("laptop-1280", 1280, 800),
    vp("desktop-1920", 1920, 1080),
  ],
});
