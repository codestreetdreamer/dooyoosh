#!/usr/bin/env bash
# Runs tests/api/* against a REAL server backed by a throwaway local Postgres (never Supabase / a shared DB).
#   tests/run-api.sh                      # starts PG17, applies migrations+seed+QA fixture, builds, starts, tests
#   PAYMENTS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/dy_api tests/run-api.sh   # use an existing throwaway DB
# Env: PG_BIN (default /usr/lib/postgresql/17/bin), QA_API_PG_PORT (55433), QA_API_PORT (3400), QA_SKIP_BUILD=1, QA_KEEP=1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
PGPORT_="${QA_API_PG_PORT:-55433}"
PORT="${QA_API_PORT:-3400}"
MIG="$ROOT/src/server/db/migrations"; SEED="$ROOT/src/server/db/seed"; EMU="$ROOT/src/server/db/tests/supabase_emulation.sql"
STARTED_PG=""; SRV_PID=""; WORK="$(mktemp -d /tmp/qa-api-XXXX)"
cleanup() {
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null || true
  [ -n "$STARTED_PG" ] && [ -z "${QA_KEEP:-}" ] && "$PG_BIN/pg_ctl" -D "$WORK/pg" -m fast stop >/dev/null 2>&1 || true
  [ -z "${QA_KEEP:-}" ] && rm -rf "$WORK" || echo "kept $WORK"
}
trap cleanup EXIT

if [ -z "${PAYMENTS_TEST_DATABASE_URL:-}" ]; then
  "$PG_BIN/initdb" -D "$WORK/pg" -U postgres --auth=trust >/dev/null
  "$PG_BIN/pg_ctl" -D "$WORK/pg" -o "-p $PGPORT_ -k $WORK" -l "$WORK/pg.log" start >/dev/null
  STARTED_PG=1
  "$PG_BIN/psql" -h 127.0.0.1 -p "$PGPORT_" -U postgres -qc "create database dy_api"
  export PAYMENTS_TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:$PGPORT_/dy_api"
fi
case "$PAYMENTS_TEST_DATABASE_URL" in *supabase*|*pooler*) echo "refusing: PAYMENTS_TEST_DATABASE_URL must be a throwaway local DB" >&2; exit 2;; esac
PSQL=("$PG_BIN/psql" "$PAYMENTS_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q)

if [ -n "$STARTED_PG" ]; then
  [ -f "$EMU" ] && "${PSQL[@]}" -f "$EMU" >/dev/null
  for tag in $(node -e "for (const e of require('$MIG/meta/_journal.json').entries) console.log(e.tag)"); do "${PSQL[@]}" -f "$MIG/$tag.sql" >/dev/null; echo "migrated $tag"; done
  for s in reference demo; do [ -f "$SEED/$s.sql" ] && "${PSQL[@]}" -f "$SEED/$s.sql" >/dev/null && echo "seeded $s"; done
  "${PSQL[@]}" -f "$ROOT/tests/api/fixtures/catalog-hidden.sql" && echo "seeded QA hidden rows"
fi

# Fake, local-only secrets. NODE_ENV=production (next start) => strict serverEnv.
export DATABASE_URL="$PAYMENTS_TEST_DATABASE_URL" PAYMENTS_STORE=postgres PAYMENT_PROVIDER=mock PAYMENT_MODE=sandbox \
  NEXT_PUBLIC_PAYMENT_MODE=sandbox ALLOW_MOCK_IN_PRODUCTION=true SANDBOX_SIMULATOR_ENABLED=true \
  NEXT_PUBLIC_SITE_URL="http://localhost:$PORT" NEXT_PUBLIC_SUPABASE_URL=https://qa.invalid.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=qa-anon \
  SUPABASE_SERVICE_ROLE_KEY=qa-fake DEFAULT_CURRENCY=UZS NEXT_PUBLIC_DEFAULT_CURRENCY=UZS EMAIL_FROM=qa@dooyoosh.test RESEND_API_KEY=re_qa_fake \
  CRON_SECRET=qa-cron-secret-0123456789abcdef ORDER_TOKEN_SECRET=qa_order_token_secret_0123456789abcdef0123 \
  PAYMENT_WEBHOOK_SECRET=qa_mock_webhook_secret_0123456789abcdef NEWSLETTER_HASH_SECRET=qa_newsletter_hash_secret_0123456789abcdef \
  TRUSTED_IP_HEADER=x-vercel-forwarded-for
cd "$ROOT"
[ -z "${QA_SKIP_BUILD:-}" ] && pnpm build > "$WORK/build.log" 2>&1 || { [ -z "${QA_SKIP_BUILD:-}" ] && { tail -30 "$WORK/build.log"; exit 1; }; }
pnpm exec next start -p "$PORT" > "$WORK/server.log" 2>&1 & SRV_PID=$!
for i in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$PORT/api/v1/products?limit=1" && break; sleep 1; done
curl -sf -o /dev/null "http://localhost:$PORT/api/v1/products?limit=1" || { echo "server did not come up"; tail -40 "$WORK/server.log"; exit 1; }

Q() { "$PG_BIN/psql" "$PAYMENTS_TEST_DATABASE_URL" -At -c "$1"; }
export BASE_URL="http://localhost:$PORT/api/v1" QA_NEXT_DIR="$ROOT/.next"
export QA_HIDDEN_VARIANT_IDS="$(Q "select string_agg(v.id::text, ',') from product_variants v join products p on p.id=v.product_id where p.slug like 'qa-hidden-%' or v.sku='QA-INACTIVE-VAR'")"
export QA_V137="$(Q "select id from product_variants where stock_on_hand=137 limit 1")"
export QA_V137_PRICE="$(Q "select coalesce(v.price_cents,p.base_price_cents) from product_variants v join products p on p.id=v.product_id where v.stock_on_hand=137 limit 1")"
export QA_VARIANT_ID="$QA_V137" QA_SHIPPING_METHOD_ID="$(Q "select sm.id from shipping_methods sm join markets m on m.id=sm.market_id where m.code='UZ' and sm.is_active limit 1")"
cd "$ROOT/tests/api" && { [ -d node_modules ] || pnpm install --frozen-lockfile >/dev/null; } && pnpm exec vitest run "$@"
