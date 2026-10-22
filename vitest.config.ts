/**
 * Root test config (QA & Security, OWNERSHIP.md). `pnpm test` runs:
 *   - unit tests next to the code: src/**\/*.test.ts (payments, checkout, orders, lib, ...)
 *   - in-process route attacks: tests/integration/**\/*.test.ts (import route handlers, memory store)
 *   - HTTP contract suite: tests/api/**\/*.test.js (skips cleanly when no server at BASE_URL)
 * Not included: tests/db (own package, needs local Postgres: `pnpm -C tests/db test`) and
 * tests/e2e (Playwright: `pnpm -C tests/e2e test`).
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
// Vitest overwrites process.env.BASE_URL with "/" in workers; forward the caller's value.
const QA_BASE_URL = process.env.QA_BASE_URL || (/^https?:/.test(process.env.BASE_URL ?? "") ? process.env.BASE_URL! : "");

export default defineConfig({
  resolve: {
    alias: {
      "@": `${root}src`,
      "server-only": `${root}tests/support/server-only.ts`,
    },
  },
  test: {
    root,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/integration/**/*.test.ts", "tests/api/**/*.test.js"],
    exclude: ["**/node_modules/**", "tests/db/**", "tests/e2e/**", ".next/**"],
    testTimeout: 20_000,
    env: QA_BASE_URL ? { QA_BASE_URL } : {},
  },
});
