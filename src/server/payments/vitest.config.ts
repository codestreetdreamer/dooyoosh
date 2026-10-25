/**
 * Unit tests for Payments & Orders (src/server/{payments,checkout,orders}). Root vitest.config.ts is QA-owned and
 * does not exist yet; run with:  pnpm exec vitest run --config src/server/payments/vitest.config.ts
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../../..", import.meta.url));

export default defineConfig({
  root,
  resolve: { alias: { "@": `${root}src`, "server-only": `${root}src/server/payments/__tests__/server-only-stub.ts` } },
  test: { include: ["src/server/{payments,checkout,orders}/**/*.test.ts"], environment: "node" },
});
