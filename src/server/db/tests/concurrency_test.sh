#!/usr/bin/env bash
# Real-concurrency tests against a LOCAL throwaway DB built by apply-local.sh (commits data; never run on Supabase).
# Usage: PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=... ./concurrency_test.sh [dbname]
set -euo pipefail
DB=${1:-dooyoosh_test}
N=${N:-20}
P=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
TAG="cc$(date +%s%N | tail -c 7)"
fail() { echo "FAIL: $*"; exit 1; }

# fixture: one variant with stock 1, a second with stock 5, and N checkouts each wanting 1 unit
"${P[@]}" <<SQL
insert into public.markets (code, currency, is_active) values ('$TAG', 'UZS', true);
insert into public.shipping_methods (market_id, code, name, min_days, max_days) select id, '$TAG', '$TAG', 1, 2 from public.markets where code = '$TAG';
insert into public.categories (slug, kind) values ('$TAG', 'clothing');
insert into public.products (slug, category_id, status, base_price_cents, currency, size_system, ikpu_code, published_at)
  select '$TAG', id, 'published', 10000000, 'UZS', 'alpha', '12345678901234567', now() - interval '1 day' from public.categories where slug = '$TAG';
insert into public.product_variants (product_id, sku, size) select id, '$TAG-ONE', 'M' from public.products where slug = '$TAG';
insert into public.product_variants (product_id, sku, size) select id, '$TAG-FIVE', 'L' from public.products where slug = '$TAG';
do \$\$ begin perform public.adjust_stock(id, case when sku like '%-ONE' then 1 else 5 end, 'restock', 'cc', null) from public.product_variants where sku like '$TAG-%'; end \$\$;
set client_min_messages = warning;
create schema if not exists cc_test;
create table if not exists cc_test.checkouts (tag text, n int, variant text, checkout_id uuid);
do \$\$
declare v record; g int; cid uuid;
begin
  for v in select id, sku from public.product_variants where sku in ('$TAG-ONE', '$TAG-FIVE') loop
    for g in 1..$N loop
      insert into public.checkouts (email, locale, currency, items, shipping_address, shipping_method_id, subtotal_cents,
                                    shipping_cents, total_cents, provider, access_token_hash, expires_at)
      select 'cc@test.invalid', 'en', 'UZS',
             jsonb_build_array(jsonb_build_object('variantId', v.id, 'sku', v.sku, 'productName', 'CC', 'size', 'M', 'colour', null,
                                                  'unitPriceMinor', 10000000, 'quantity', 1, 'lineTotalMinor', 10000000)),
             '{}', sm.id, 10000000, 0, 10000000, 'mock', 'h', now() + interval '30 min'
        from public.shipping_methods sm where sm.code = '$TAG'
      returning id into cid;
      insert into cc_test.checkouts values ('$TAG', g, v.sku, cid);
    end loop;
  end loop;
end \$\$;
SQL

race() { # $1 = sku
  local pids=() ok=0 oos=0 other=0
  mapfile -t ids < <("${P[@]}" -c "select checkout_id from cc_test.checkouts where tag='$TAG' and variant='$1' order by n")
  local dir; dir=$(mktemp -d)
  for i in "${!ids[@]}"; do
    ( if "${P[@]}" -c "select public.reserve_checkout('${ids[$i]}', jsonb_build_array(jsonb_build_object('variant_id', (select id from public.product_variants where sku='$1'), 'quantity', 1)), now() + interval '35 min')" >/dev/null 2>"$dir/$i.err"; then echo ok > "$dir/$i"; else echo err > "$dir/$i"; fi ) &
  done
  wait
  for i in "${!ids[@]}"; do
    if [ "$(cat "$dir/$i")" = ok ]; then ok=$((ok+1)); elif grep -q OUT_OF_STOCK "$dir/$i.err"; then oos=$((oos+1)); else other=$((other+1)); cat "$dir/$i.err"; fi
  done
  rm -rf "$dir"
  echo "$ok $oos $other"
}

read -r ok oos other < <(race "$TAG-ONE")
[ "$ok" = 1 ] && [ "$oos" = $((N-1)) ] && [ "$other" = 0 ] || fail "stock 1: ok=$ok oos=$oos other=$other"
st=$("${P[@]}" -c "select stock_on_hand||'/'||stock_reserved from public.product_variants where sku='$TAG-ONE'")
[ "$st" = "1/1" ] || fail "stock 1 after race: $st"
echo "PASS concurrency: $N parallel reserve_checkout on stock 1 -> 1 ok, $oos OUT_OF_STOCK, 0 other errors, on_hand/reserved=$st"

read -r ok oos other < <(race "$TAG-FIVE")
[ "$ok" = 5 ] && [ "$other" = 0 ] || fail "stock 5: ok=$ok oos=$oos other=$other"
st=$("${P[@]}" -c "select stock_on_hand||'/'||stock_reserved from public.product_variants where sku='$TAG-FIVE'")
[ "$st" = "5/5" ] || fail "stock 5 after race: $st"
echo "PASS concurrency: $N parallel reserve_checkout on stock 5 -> exactly 5 ok, never oversold ($st)"

# concurrent duplicate webhooks: 10 parallel converts of the winning checkout -> exactly one 'paid'
WIN=$("${P[@]}" -c "select c.checkout_id from cc_test.checkouts c join public.stock_reservations r on r.checkout_id=c.checkout_id where c.tag='$TAG' and c.variant='$TAG-ONE' and r.status='active'")
dir=$(mktemp -d)
for i in $(seq 1 10); do
  ( "${P[@]}" -c "select public.convert_checkout_to_order('$WIN', '{\"provider\":\"mock\",\"provider_payment_id\":\"$TAG-pay\",\"amount_minor\":10000000,\"currency\":\"UZS\"}')->>'status'" > "$dir/$i" 2>&1 || true ) &
done
wait
paid=$(cat "$dir"/* | grep -c '^paid$' || true); again=$(cat "$dir"/* | grep -c '^already_converted$' || true)
rm -rf "$dir"
[ "$paid" = 1 ] && [ "$again" = 9 ] || fail "parallel convert: paid=$paid already=$again"
st=$("${P[@]}" -c "select stock_on_hand||'/'||stock_reserved from public.product_variants where sku='$TAG-ONE'")
[ "$st" = "0/0" ] || fail "after convert: $st"
echo "PASS concurrency: 10 parallel convert_checkout_to_order (duplicate webhook) -> 1 paid, 9 already_converted, stock $st"

# expiry sweep racing with late payments on the FIVE variant: no negative stock, every checkout ends consistent
mapfile -t five < <("${P[@]}" -c "select r.checkout_id from public.stock_reservations r join cc_test.checkouts c on c.checkout_id=r.checkout_id where c.tag='$TAG' and r.status='active'")
for id in "${five[@]}"; do
  ( "${P[@]}" -c "select public.convert_checkout_to_order('$id', jsonb_build_object('provider','mock','provider_payment_id','$TAG-'||'$id','amount_minor',10000000,'currency','UZS'))->>'status'" >/dev/null 2>&1 || true ) &
done
( "${P[@]}" -c "select public.release_expired_reservations(now() + interval '1 hour', 500)" >/dev/null ) &
wait
res=$("${P[@]}" -c "select count(*) filter (where o.status='paid')||' paid, '||count(*) filter (where o.status='stock_conflict')||' conflict' from public.orders o join cc_test.checkouts c on c.checkout_id=o.checkout_id where c.tag='$TAG' and c.variant='$TAG-FIVE'")
st=$("${P[@]}" -c "select stock_on_hand||'/'||stock_reserved from public.product_variants where sku='$TAG-FIVE'")
paidn=${res%% paid*}
confn=${res#*, }; confn=${confn%% conflict}
[ $((paidn+confn)) = 5 ] || fail "sweep vs convert: some converts errored ($res)"
[ "$st" = "$((5-paidn))/0" ] || fail "sweep vs convert: $res, stock $st"
bad=$("${P[@]}" -c "select count(*) from public.product_variants v where v.stock_on_hand <> coalesce((select sum(delta) from public.inventory_movements m where m.variant_id=v.id),0) or v.stock_reserved < 0")
[ "$bad" = 0 ] || fail "ledger mismatch on $bad variants"
echo "PASS concurrency: 5 late converts racing the expiry sweep -> $res, stock $st, ledger consistent"
# idempotencyKey: 10 parallel submits with the same key -> 1 checkout, 1 reservation, all callers get the same id
"${P[@]}" -c "do \$\$ begin perform public.adjust_stock(id, 3, 'restock', 'cc idem', null) from public.product_variants where sku = '$TAG-FIVE'; end \$\$"
KEY=$(cat /proc/sys/kernel/random/uuid)
dir=$(mktemp -d)
for i in $(seq 1 10); do
  ( "${P[@]}" > "$dir/$i" 2>&1 <<SQL
begin;
insert into public.checkouts (email, locale, currency, items, shipping_address, shipping_method_id, subtotal_cents, shipping_cents,
                              total_cents, provider, access_token_hash, expires_at, idempotency_key)
select 'idem@test.invalid', 'en', 'UZS',
       jsonb_build_array(jsonb_build_object('variantId', v.id, 'sku', v.sku, 'productName', 'CC', 'size', 'L', 'colour', null,
                                            'unitPriceMinor', 10000000, 'quantity', 1, 'lineTotalMinor', 10000000)),
       '{}', sm.id, 10000000, 0, 10000000, 'mock', 'h', now() + interval '30 min', '$KEY'
  from public.product_variants v, public.shipping_methods sm where v.sku = '$TAG-FIVE' and sm.code = '$TAG'
on conflict (idempotency_key) do nothing;
select public.reserve_checkout(c.id, jsonb_build_array(jsonb_build_object('variant_id', v.id, 'quantity', 1)), now() + interval '35 min')
  from public.checkouts c, public.product_variants v where c.idempotency_key = '$KEY' and v.sku = '$TAG-FIVE';
select 'ID=' || id || ' UNTIL=' || reserved_until from public.checkouts where idempotency_key = '$KEY';
commit;
SQL
  ) &
done
wait
ids=$(grep -h '^ID=' "$dir"/* | sort -u | wc -l); okn=$(grep -l '^ID=' "$dir"/* | wc -l)
errs=$(grep -l ERROR "$dir"/* | wc -l || true); [ "$errs" = 0 ] || cat "$dir"/*
rm -rf "$dir"
nres=$("${P[@]}" -c "select count(*) from public.stock_reservations r join public.checkouts c on c.id = r.checkout_id where c.idempotency_key = '$KEY'")
[ "$ids" = 1 ] && [ "$okn" = 10 ] && [ "$nres" = 1 ] || fail "idempotency: distinct ids=$ids callers ok=$okn reservations=$nres"
echo "PASS idempotencyKey: 10 parallel submits with one key -> 1 checkout, 1 reservation, same id + reserved_until for all 10"
echo "ALL CONCURRENCY TESTS PASSED"
