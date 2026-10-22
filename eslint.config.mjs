import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  { ignores: ["node_modules/**", ".next/**", "tests/db/node_modules/**", "src/server/db/migrations/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Integration rule 3: src/app never imports the DB layer directly.
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["@/server/db/*", "@/server/db", "drizzle-orm", "postgres"] }],
    },
  },
];
