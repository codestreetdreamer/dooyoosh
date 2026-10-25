#!/usr/bin/env bash
# Seed ids are deterministic (0009-b): every seeded row's id == uuid5(NS, '<kind>:<key>') from seed/seed_ids.py.
# Usage: PGDATABASE=dooyoosh_api seed_ids_test.sh   (needs reference + demo seeds applied)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
exp=$(python3 "$HERE/../seed/seed_ids.py" | sed -E "s/^  \('([^']+)', '([0-9a-f-]+)'::uuid\),?$/\1 \2/" | sort)
got=$(psql -X -At -F' ' -v ON_ERROR_STOP=1 <<'SQL' | sort
select 'market:' || code, id from public.markets where code = 'UZ'
union all select 'category:' || slug, id from public.categories where slug in ('clothing','footwear','accessories')
union all select 'shipping_method:UZ:' || code, id from public.shipping_methods where code = 'placeholder-standard'
union all select 'shipping_rate:placeholder-standard:0', r.id from public.shipping_rates r join public.shipping_methods m on m.id = r.shipping_method_id where m.code = 'placeholder-standard'
union all select 'product:' || slug, id from public.products where slug like 'demo-%'
union all select 'product_image:' || storage_path, id from public.product_images where storage_path like 'demo/%'
union all select 'variant:' || sku, id from public.product_variants where sku like 'DEMO-%'
union all select 'tag:' || slug, id from public.tags where slug like 'demo-%'
union all select 'article:' || slug, id from public.articles where slug like 'demo-%';
SQL
)
if [[ "$exp" == "$got" ]]; then echo "PASS seed ids deterministic ($(wc -l <<<"$exp") rows)"; else diff <(echo "$exp") <(echo "$got") | head; echo "FAIL seed ids"; exit 1; fi
