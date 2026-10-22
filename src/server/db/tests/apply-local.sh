#!/usr/bin/env bash
# Build a fresh local test DB: Supabase emulation + all migrations (+ seeds unless NO_SEED=1).
# Usage: PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres ./apply-local.sh [dbname]
# Needs a superuser on a LOCAL Postgres 17. Never point this at Supabase.
set -euo pipefail
DB=${1:-dooyoosh_test}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
"${PSQL[@]}" -d "$DB" -f "$HERE/supabase_emulation.sql"
for f in "$ROOT"/migrations/*.sql; do
  echo "migrate $(basename "$f")"
  # drizzle statement breakpoints are SQL comments, so each file runs as-is in one transaction
  "${PSQL[@]}" -1 -d "$DB" -f "$f"
done
if [ "${NO_SEED:-0}" != "1" ]; then
  for f in reference.sql demo.sql; do
    echo "seed $f"; "${PSQL[@]}" -1 -d "$DB" -f "$ROOT/seed/$f"
  done
fi
echo "OK: $DB ready"
