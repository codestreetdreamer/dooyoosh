# DOOYOOSH e2e (QA-owned)

```
cd tests/e2e && pnpm i && npx playwright install chromium   # CI: --with-deps
SITE_URL=http://localhost:3000 npx playwright test          # skips cleanly if the app is down
```
Viewports: 375x812, 768x1024, 1280x800, 1920x1080. Env: `SITE_URL`, `QA_LOCALES` (default `uz,en`), `QA_PRODUCT_SLUG`, `QA_ARTICLE_SLUG`, `QA_CRAWL_MAX`.

## Selectors Frontend is asked to provide (`data-testid`)
`size-option`, `add-to-bag`, `bag-line`, `bag-line-issue` (line flagged after a 409), `bag-qty` (input or text), `bag-qty-increase`,
`bag-remove`, `bag-subtotal`, `bag-empty`, `shipping-method`, `checkout-submit`, `reservation-countdown` (mm:ss from `reservedUntil`).
Errors are announced in an element with `role="alert"`, in human words (never the raw code).
Accessible-name fallbacks exist for buttons, but the testids make the suite stable across uz/en/ru.
