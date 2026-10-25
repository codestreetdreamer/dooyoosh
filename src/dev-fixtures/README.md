# DEV FIXTURES — NOT PRODUCTION DATA

Sample catalog, journal and shipping data used ONLY when `NEXT_PUBLIC_USE_FIXTURES=true`
and the deployment is not a Vercel production deployment (see `src/lib/store/data-source.ts`).
Shapes follow `src/contracts/*`. Images are tonal SVG placeholders in `public/placeholders/`.
Prices are UZS minor units (tiyin) to match the demo seed; the UI formats via `formatMoney(amount, currency)`.
Never import these files from production code paths other than the guarded data source.
