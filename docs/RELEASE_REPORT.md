# DOOYOOSH — Release report

**Date:** 2026-10-25 (Architect)  
**Scope:** Sprint / integration status after `integration/trial-2`.  
**Remote:** [codestreetdreamer/dooyoosh](https://github.com/codestreetdreamer/dooyoosh) exists; **code is not yet pushed** (Architect box `gh` auth pending). Staging Supabase ref `bmigqxmswskihqrkeezh` has migrations **0000–0009** applied; this report does not re-touch staging.

---

## Integration trial-2 (green where listed)

Branch: `integration/trial-2` @ `6858206`  
Base: `main` @ `17e405d`  
Merge: no-ff, **no conflicts**.

| Tip merged | Commit | Notes |
|---|---|---|
| `feat/db` | `bc54712` (0009) then `4d89f5f` | Expired-reservation conflict + `shipping_method_name`; types regen after staging |
| `feat/payments` | `61392b8` | Writes/reads `shipping_method_name`; 134/134 with PG store |
| `feat/qa` | `d35fb38` (incl. `4bebe92`) then `da083dd` | Bearer/`accessToken` tests + `tests/run-api.sh`; newsletter fixture fix |
| `feat/frontend` | `6b95786` | `maxQuantity` removed; `lowStock` / `insufficient_stock` |

### Verification (from trial-2 SUMMARY)

| Gate | Result |
|---|---|
| `pnpm install` (offline) | OK |
| `pnpm typecheck` | OK |
| `pnpm lint` | OK (no warnings) |
| `pnpm build` | OK (21/21 pages, dummy `NEXT_PUBLIC_*` sandbox env) |
| Root `pnpm test` | **204 passed** / 200 skipped (404 total) after `da083dd` |
| Payments suite (memory) | **125 passed** / 9 skipped (134) |
| Payments suite (Postgres, 0000–0009 + seed) | **134 / 134** |
| `tests/db` (throwaway PG17, 0000–0009) | **135 / 135** |

Agent worktrees left untouched at those tips (`dooyoosh-db`, `-pay`, `-fe`, `-qa`).

---

## What works (P0 product surface in sandbox)

- Catalog / journal / cart validate contracts without exposing exact stock counts (`lowStock` only).
- Checkout + stock reservation; convert/release via SECURITY DEFINER functions; **expired reservation → `stock_conflict`** (record + abort) — P1 from earlier trials closed in 0009.
- Payme/Click adapters + mock provider; webhook IP only from `TRUSTED_IP_HEADER`; Bearer-only guest order/checkout access (`?token=` → 400).
- Newsletter / rate-limit IP hashing; `NEWSLETTER_HASH_SECRET` required in production env validation.
- Staging RLS: newsletter attempt table closed; service_role-only for stock convert paths checked by QA/Backend.

---

## Known defects (not release blockers for sandbox demo)

### `tests/run-api.sh` — **5 failed** / 59 passed / 135 skipped (199)

Owner: **QA & Security** (seed design nuance may need Backend if they want `ON COMMIT PRESERVE`).

| Issue | Detail |
|---|---|
| Seed | `demo.sql` error `relation seed_ids does not exist` — `TEMP TABLE … ON COMMIT DROP` without `psql -1`; `apply-local.sh` uses `-1` and succeeds |
| Cascade | catalog-hidden fixture null `product_id` after seed miss |
| `flows.test.js` | `GET /orders/{ref}?token=` and checkout status `?token=` expect 404, get **400** — correct Bearer-only behaviour; tests outdated |
| `webhooks.test.js` | Payme/Click auth cases expect provider JSON, get **404** — runner sets `PAYMENT_PROVIDER=mock` so `/webhooks/payme|click` not mounted |

Root Vitest and payments/db suites are green; do not treat run-api red as a payments regression.

---

## Production blockers (do not claim live payments)

1. **Payme / Click international (foreign-issued) Visa/MC** — **UNVERIFIED** for Merchant API; Octo documents foreign cards but needs Octobank + **.uz** + **static IP**.
2. **Static egress IP** for Click/Octo (and similar) — Vercel serverless is insufficient for live provider allow-lists; hosting choice OPEN.
3. **Frankfurt data residency** — MVP/staging OK per research; **legal confirmation** for live customer PII under UZ rules still required (`ARCHITECTURE` §12.7 / §13).
4. **Merchant registration** — YaTT or MChJ, settlement account (расчётный счёт), IKPU/MXIK + VAT on products for fiscal (ZRU-792).
5. **Live provider keys** — Payme/Click (and webhook secrets) only in private 1:1 with Payments & Orders; never in group chat or git.
6. **Supabase public signup** — must be **off** on the project before any real users.
7. **`NEWSLETTER_HASH_SECRET`** — 32+ chars, required in production (boot fails without it); no plain sha256 fallback in prod.

Also still needed for a real launch (accounts checklist): Vercel project linked to repo, Resend + domain DNS, legal page copy, logo assets — see [`DEPLOY_READINESS.md`](DEPLOY_READINESS.md).

---

## Sandbox vs live — hard rules

| Mode | Env | Meaning |
|---|---|---|
| Local / CI | `PAYMENT_MODE=sandbox`, usually `PAYMENT_PROVIDER=mock` | No real money |
| Public MVP demo on Vercel | `PAYMENT_MODE=sandbox` **and** `ALLOW_MOCK_IN_PRODUCTION=true` | Mock only; demo banner |
| Live | `PAYMENT_MODE=live` + real provider keys | Moves money; mock refused |

- **Never** claim the site processes live payments until blockers above are cleared and `PAYMENT_MODE=live` is intentional.
- **Success page / redirect is not payment proof.** Only verified Payme Perform / Click Complete (or mock equivalent in sandbox) after idempotent `payment_events` insert marks the order paid.
- `NEXT_PUBLIC_PAYMENT_MODE` must match server mode; anything but `live` shows the permanent demo banner.

---

## Git / deploy note

- Tips above are **local** (and worktrees). **No push** of `main` or feature branches until Architect completes `gh` login with Mirfozil in 1:1.
- Do not merge `integration/trial-2` to `main` via force; Architect will integrate after QA closes run-api failures (or documents intentional skips) and Frontend e2e (fixtures off) is reported.

---

## Owners for follow-ups

| Item | Owner |
|---|---|
| Fix `tests/run-api.sh` seed + Bearer/webhook expectations | QA & Security |
| Optional seed `ON COMMIT` design | Backend & Database |
| Push + Vercel link | Architect + Mirfozil (`gh` auth) |
| Live keys / YaTT docs | Mirfozil → Payments & Orders (1:1 only) |
| Disable public signup | Mirfozil (Supabase Auth settings) |
