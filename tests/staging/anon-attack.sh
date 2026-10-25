#!/usr/bin/env bash
# Live read-only attack on a Supabase project as anon. Only harmless writes that MUST be rejected. No data is created on success.
# Usage: SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon or publishable> tests/staging/anon-attack.sh
URL="${SUPABASE_URL:?set SUPABASE_URL}"
ANON="${SUPABASE_ANON_KEY:?set SUPABASE_ANON_KEY (anon/publishable only, NEVER service_role)}"
REST="$URL/rest/v1"
hdr=(-H "apikey: $ANON" -H "Authorization: Bearer $ANON")
pass=0; fail=0
# $1 label  $2 expected: deny|allow  $3.. curl args
chk () {
  local label="$1" exp="$2"; shift 2
  local out code body
  out=$(curl -s -w $'\n%{http_code}' "$@")
  code=$(echo "$out" | tail -1); body=$(echo "$out" | head -c 300 | tr '\n' ' ')
  local denied="no"
  if [[ "$code" =~ ^(401|403|404)$ ]]; then denied="yes"
  elif [[ "$exp" == "deny" && "$code" == "200" && "$(echo "$out" | head -1)" == "[]" ]]; then denied="yes"  # RLS filtered: nothing affected
  elif echo "$body" | grep -qiE "permission denied|violates row-level|JWT|not authorized|PGRST301|insufficient|row-level security"; then denied="yes"; fi
  local verdict
  if [[ "$exp" == "deny" && "$denied" == "yes" ]]; then verdict="PASS"; pass=$((pass+1))
  elif [[ "$exp" == "allow" && "$denied" == "no" && "$code" =~ ^2 ]]; then verdict="PASS"; pass=$((pass+1))
  else verdict="FAIL"; fail=$((fail+1)); fi
  printf '%-5s [%-5s exp=%-5s] %-45s http=%s  %s\n' "$verdict" "$denied" "$exp" "$label" "$code" "$body" | head -c 400; echo
}
echo "=== ANON reads (must deny private tables) ==="
for t in orders checkouts payments admin_users inventory_movements stock_reservations refunds payment_events provider_transactions profiles; do
  chk "read $t" deny "${hdr[@]}" "$REST/$t?select=*&limit=1"
done
echo "=== ANON reads of public storefront (must allow) ==="
for t in storefront_products storefront_variants storefront_articles; do
  chk "read $t" allow "${hdr[@]}" "$REST/$t?select=*&limit=1"
done
chk "rpc product_facets" allow "${hdr[@]}" -X POST "$REST/rpc/product_facets" -H "Content-Type: application/json" -d '{}'
echo "=== ANON writes (must deny) ==="
chk "update product_variants" deny "${hdr[@]}" -X PATCH "$REST/product_variants?id=not.is.null" -H "Content-Type: application/json" -H "Prefer: return=minimal" -d '{"stock_reserved":0}'
chk "insert payment_events" deny "${hdr[@]}" -X POST "$REST/payment_events" -H "Content-Type: application/json" -d '{"provider":"mock","event_id":"qa-'$RANDOM'","type":"qa"}'
chk "insert admin_users" deny "${hdr[@]}" -X POST "$REST/admin_users" -H "Content-Type: application/json" -d '{"role":"owner"}'
chk "insert orders" deny "${hdr[@]}" -X POST "$REST/orders" -H "Content-Type: application/json" -d '{"reference":"QA-HACK"}'
echo "=== ANON RPC on protected stock functions (must deny) ==="
chk "rpc reserve_checkout" deny "${hdr[@]}" -X POST "$REST/rpc/reserve_checkout" -H "Content-Type: application/json" -d '{"p_checkout_id":"00000000-0000-0000-0000-000000000000","p_items":[],"p_expires_at":"2030-01-01T00:00:00Z"}'
chk "rpc convert_checkout_to_order" deny "${hdr[@]}" -X POST "$REST/rpc/convert_checkout_to_order" -H "Content-Type: application/json" -d '{"p_checkout_id":"00000000-0000-0000-0000-000000000000","p_order":{}}'
chk "rpc release_checkout" deny "${hdr[@]}" -X POST "$REST/rpc/release_checkout" -H "Content-Type: application/json" -d '{"p_checkout_id":"00000000-0000-0000-0000-000000000000","p_reason":"expired"}'
chk "rpc release_expired_reservations" deny "${hdr[@]}" -X POST "$REST/rpc/release_expired_reservations" -H "Content-Type: application/json" -d '{"p_now":"2030-01-01T00:00:00Z","p_limit":1}'
chk "rpc adjust_stock" deny "${hdr[@]}" -X POST "$REST/rpc/adjust_stock" -H "Content-Type: application/json" -d '{"p_variant_id":"00000000-0000-0000-0000-000000000000","p_delta":1,"p_reason":"return","p_note":null,"p_actor_id":null}'
chk "rpc variant_availability (public)" allow "${hdr[@]}" -X POST "$REST/rpc/variant_availability" -H "Content-Type: application/json" -d '{"p_variant_ids":["00000000-0000-0000-0000-000000000000"]}'
for t in product_variants audit_log order_items order_events shipments newsletter_subscribers stock_reservations refunds; do chk "read $t" deny "${hdr[@]}" "$REST/$t?select=*&limit=1"; done
chk "products drafts/scheduled/archived hidden" allow "${hdr[@]}" "$REST/products?select=slug&or=(status.neq.published,published_at.gt.now(),archived_at.not.is.null)"
S="$URL/storage/v1"; printf '\x89PNG\r\n\x1a\n' > /tmp/qa-probe.png
chk "storage upload png" deny "${hdr[@]}" -X POST "$S/object/product-images/qa-probe-$RANDOM.png" -H "Content-Type: image/png" --data-binary @/tmp/qa-probe.png
chk "storage upsert png" deny "${hdr[@]}" -X PUT "$S/object/product-images/qa-probe-x.png" -H "Content-Type: image/png" -H "x-upsert: true" --data-binary @/tmp/qa-probe.png
chk "storage delete" deny "${hdr[@]}" -X DELETE "$S/object/product-images" -H "Content-Type: application/json" -d '{"prefixes":["qa-probe-x.png"]}'
chk "forged alg=none service_role JWT" deny -H "apikey: $ANON" -H "Authorization: Bearer $(printf '{"alg":"none","typ":"JWT"}' | base64 -w0 | tr '+/' '-_' | tr -d '=').$(printf '{"role":"service_role","exp":4102444800}' | base64 -w0 | tr '+/' '-_' | tr -d '=')." "$REST/orders?select=id&limit=1"
echo "RESULTS pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
