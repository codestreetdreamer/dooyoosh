# DOOYOOSH — QA & Security report (updated 2026-10-25)

Branch under test: `feat/qa` @ `da083dd` (worktree `/workspace/dooyoosh-qa`). Staging Supabase was **not** called for this update. Evidence is from local git history, `/workspace/review/integration/trial-*`, and on-disk Playwright artifacts under `tests/e2e/artifacts/`.

Report #1 (2026-10-22) covered migration `0000_init` only; many of those P0/P1 schema/RLS items were addressed in later Backend migrations (0001–0009) and are not re-listed here unless still open with fresh evidence.

---

## Closed (this sprint — evidence on disk)

| ID | Sev | Agent | Issue | Evidence | Status |
|---|---|---|---|---|---|
| QA-P1-EXPIRED | P1 | Backend & Database | Muddati o'tgan rezerv `convert` da `paid` bo'lishi mumkin edi | Backend `bc54712` (0009: expired-reservation conflict + `shipping_method_name`); QA suite `d35fb38` — `tests/db` **135/135** on throwaway PG17 (`/workspace/review/integration/trial-2/SUMMARY.txt`, `test-db.txt`) | **Closed** |
| QA-BEARER | P1 | QA & Security / Payments | Status/orders hali `guestToken` / `?token=` kontraktida | QA `4bebe92` — Bearer-only (`?token=` → 400), `accessToken` only; merged into trial-2 tip path via `d35fb38` | **Closed** |
| QA-RUN-API-SEED | P2 | QA & Security | `tests/run-api.sh` seed: `demo.sql` TEMP `seed_ids` yo'qoladi (`psql -1` yo'q) | Trial-2 log: `/workspace/review/integration/trial-2/SUMMARY.txt` + `test-api.txt` (5 fail). Fix present in **uncommitted** working tree on `feat/qa` (`tests/run-api.sh` uses `psql -1`). Claimed room hash `12eff5e` is **not** in this git object store | **Fixed locally (WIP)** — commit pending |
| QA-RUN-API-TOKEN | P2 | QA & Security | `flows.test.js` `?token=` 404 kutadi, API 400 qaytaradi | Same trial-2 log; WIP fix in `tests/api/flows.test.js` (expect 400 / `VALIDATION_ERROR`) | **Fixed locally (WIP)** |
| QA-RUN-API-WH | P2 | QA & Security | `webhooks.test.js` Payme/Click 200 kutadi, `PAYMENT_PROVIDER=mock` → 404 | Same trial-2 log; WIP fix: deep Payme/Click `skipIf` unless provider set; mock asserts 404 | **Fixed locally (WIP)** |

Trial-2 green (Architect `/workspace/review/integration/trial-2/SUMMARY.txt`): typecheck, lint, `next build` 21/21, root `pnpm test` 204/204, payments Postgres 134/134, `tests/db` 135/135. Tip used: FE `6b95786`, DB `bc54712` (+ types `4d89f5f`), Pay `61392b8`, QA `da083dd`.

Unit `src/server/payments/token-leak.test.ts`: **6/6 passed** in trial-2 payments runs (`test-payments.txt`, `test-payments-postgres.txt`).

---

## E2E artifacts summary (no new run this turn)

No Playwright stdout log for port **3140** (or any `SITE_URL`) was found under `/workspace` or `/tmp`. Config default remains `http://localhost:3000` (`tests/e2e/playwright.config.js`). Outcomes below are from **existing** artifacts only — failures were not invented.

### demo-banner (`bag.spec.js` — "demo banner visible unless … live")
- **No dedicated pass/fail log** for this spec title on disk.
- **Incidental:** every `pages.spec` `error-context.md` page snapshot reviewed shows the demo note rendered (`Demo store — no real orders are accepted or charged.`).
- **No** failure screenshot named for the demo-banner test under `artifacts/failures-086eb8d/` or `artifacts/results/`.

### token-leak e2e (`bag.spec.js` — guest token / Referer hygiene)
- Failure screenshot on disk: `tests/e2e/artifacts/failures-086eb8d/bag-bag-checkout-return-pa-8ceea-ty-requests-strict-referrer-mobile-375__test-failed-1.png` (name truncated by Playwright; matches checkout-return + strict-referrer checks in `bag.spec.js`).
- Return-page screenshots exist for all four viewports (`artifacts/*-return.png`), so the mock checkout → return path was exercised at least once.
- **No** full Playwright list-reporter log with pass/fail counts for bag specs was found — treat token e2e as **previously failed on mobile-375 (referrer/token hygiene)**, not re-verified this turn.
- Separate **unit** token-leak suite: passed (see Closed).

### pages.spec axe (recorded failures)
- `artifacts/results/.last-run.json`: status `failed`, 72 failed test ids.
- **72** `error-context.md` dirs under `artifacts/results/`; all axe serious/critical failures reduce to **one unique rule id**:

| Axe rule id | Sample path | Sample target (from error-context) | Owner |
|---|---|---|---|
| `label-content-name-mismatch` | `/en` (also `/en/shop`, `/en/bag`, `/en/checkout`, `/en/pages/*`, … — 18 routes × viewports) | `a[aria-label="Bag, 0 items"]` | **Frontend & Design** |

Note: Frontend commit `af1fd5c` ("a11y label-in-name for header bag link") is **not** an ancestor of trial-2 FE tip `6b95786`, so these recorded failures remain open against the merged frontend tip. Re-run e2e after that fix is on the integration tip.

Other bag/pages failures beyond axe were not separately logged in `error-context.md` (axe assertion fires first).

---

## Open (evidence-backed only)

| ID | Sev | Agent | Issue | Repro / evidence |
|---|---|---|---|---|
| QA-A11Y-BAG-NAME | P2 | Frontend & Design | Header bag control: accessible name vs visible text mismatch (`label-content-name-mismatch`) | `tests/e2e/artifacts/results/pages-§6-pages-en-home-mobile-375/error-context.md` (and 71 sibling page×viewport dirs). Rule: `label-content-name-mismatch`. Sample path: `/en`. |
| QA-E2E-REFERRER | P2 | Frontend & Design (Referrer-Policy / token URL hygiene) | Prior e2e failure screenshot for checkout-return strict-referrer on mobile-375 | `tests/e2e/artifacts/failures-086eb8d/bag-…-strict-referrer-mobile-375__test-failed-1.png`. Needs re-run with list reporter to confirm current tip. |
| QA-RUN-API-COMMIT | P2 | QA & Security | Trial-2 `run-api.sh` fixes still uncommitted on `feat/qa` | Working tree dirty: `tests/run-api.sh`, `tests/api/flows.test.js`, `tests/api/webhooks.test.js`, `tests/api/fixtures/catalog-hidden.sql`. Room hash `12eff5e` missing from git. |

---

## Cleanup (this turn)
- Removed prunable git worktrees: `/tmp/qa-merge`, `/tmp/qa-merge2`, `/tmp/qa-p1v`, `/tmp/qa-pay`, `/tmp/qa-pay2`, `/tmp/qa-trial`.
- No stray QA test servers (next/playwright/throwaway postgres) found listening.

## Not done / out of scope this turn
- No push. No staging Supabase. No new e2e or attack runs.
- WIP run-api file changes left unstaged (only this report committed, per task scope).
