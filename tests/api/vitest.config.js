import { defineConfig } from "vitest/config";
import path from "node:path";
// Vitest overwrites process.env.BASE_URL with "/" inside workers; capture the caller's value here.
const QA_BASE_URL = process.env.QA_BASE_URL || (/^https?:/.test(process.env.BASE_URL || "") ? process.env.BASE_URL : "");
export default defineConfig({
  resolve: { alias: { zod: path.resolve(import.meta.dirname, "node_modules/zod") } },
  test: { include: ["**/*.test.js"], exclude: ["node_modules/**"], testTimeout: 20000, fileParallelism: false, env: QA_BASE_URL ? { QA_BASE_URL } : {} },
});
