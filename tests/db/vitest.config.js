import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globalSetup: ["./setup/global.js"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
    include: ["**/*.test.js"],
    exclude: ["node_modules/**"],
  },
});
