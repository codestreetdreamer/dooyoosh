/**
 * Production guard for the dev fixture layer (Frontend & Design).
 *
 * Fixtures are allowed only when NEXT_PUBLIC_USE_FIXTURES=true AND either:
 *   - this is not a production build (NODE_ENV !== "production", i.e. `pnpm dev`), or
 *   - NEXT_PUBLIC_ALLOW_FIXTURES=true is set explicitly (local/QA `pnpm build` demos),
 * and NEVER on a Vercel production deployment (VERCEL_ENV / NEXT_PUBLIC_VERCEL_ENV = "production").
 *
 * If fixtures are requested where they are not allowed, importing this module throws — it is imported by
 * app/[locale]/layout.tsx, which is prerendered during `next build`, so the BUILD FAILS.
 *
 * QA local demo build:  NEXT_PUBLIC_USE_FIXTURES=true NEXT_PUBLIC_ALLOW_FIXTURES=true pnpm build
 */
const requested = process.env.NEXT_PUBLIC_USE_FIXTURES === "true";
const vercelProd = process.env.VERCEL_ENV === "production" || process.env.NEXT_PUBLIC_VERCEL_ENV === "production";
const prodBuild = process.env.NODE_ENV === "production";
const explicitlyAllowed = process.env.NEXT_PUBLIC_ALLOW_FIXTURES === "true";

export const FIXTURES_ENABLED = requested && !vercelProd && (!prodBuild || explicitlyAllowed);

if (requested && !FIXTURES_ENABLED && typeof window === "undefined") {
  throw new Error(
    "[fixtures-guard] NEXT_PUBLIC_USE_FIXTURES=true is not allowed in this build " +
      (vercelProd ? "(Vercel production deployment). " : "(production build without NEXT_PUBLIC_ALLOW_FIXTURES=true). ") +
      "Fixtures are sample data and must never ship to production. Unset NEXT_PUBLIC_USE_FIXTURES.",
  );
}
