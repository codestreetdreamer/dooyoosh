#!/usr/bin/env bash
# One command for QA/CI: fresh local DB from migrations + seeds, then RLS, function and concurrency tests.
# Needs a LOCAL Postgres 17 superuser (PGHOST/PGPORT/PGUSER/PGPASSWORD). Never point at Supabase.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
DB=${1:-dooyoosh_test}
"$HERE/apply-local.sh" "$DB"
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/rls_test.sql" 2>&1 | grep -E "PASS|FAIL|ERROR" || true
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/functions_test.sql" 2>&1 | grep -E "PASS|FAIL|ERROR" || true
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/rls_test.sql" >/dev/null 2>&1 || { echo "RLS FAILED"; exit 1; }
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/functions_test.sql" >/dev/null 2>&1 || { echo "FUNCTIONS FAILED"; exit 1; }
"$HERE/concurrency_test.sh" "$DB"
# demo cleanup leaves no DEMO rows
psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" -1 -f "$HERE/../seed/cleanup_demo.sql" | tail -1 | grep -qx '0|0|0' \
  && echo "PASS cleanup_demo.sql removes all demo rows" || { echo "FAIL cleanup_demo"; exit 1; }
echo "ALL DB TESTS PASSED"
