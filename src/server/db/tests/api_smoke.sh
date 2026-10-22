#!/usr/bin/env bash
# Integration smoke test for the Backend-owned public API routes. Needs a running `next dev` (BASE) whose DATABASE_URL
# points at a DB built by apply-local.sh (reference + DEMO seed), and psql access to that DB (PGDATABASE).
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=dooyoosh_api BASE=http://localhost:3107 ./api_smoke.sh
set -uo pipefail
BASE=${BASE:-http://localhost:3107}/api/v1
pass=0; fail=0
# fresh client IP per run (newsletter rate limit is per IP, in memory)
IPH="x-real-ip: 10.$((RANDOM%250)).$((RANDOM%250)).$((RANDOM%250))"
psqlq() { psql -X -At -v ON_ERROR_STOP=1 -c "$1"; }
# check NAME EXPECTED_STATUS JQ_ASSERTION METHOD URL [BODY] [CONTENT_TYPE]
check() {
  local name=$1 want=$2 assert=$3 method=$4 url=$5 body=${6:-} ct=${7:-application/json}
  local out code
  if [[ -n $body ]]; then out=$(curl -s -w '\n%{http_code}' -X "$method" -H "$IPH" -H "content-type: $ct" --data "$body" "$BASE$url")
  else out=$(curl -s -w '\n%{http_code}' -X "$method" -H "$IPH" "$BASE$url"); fi
  code=${out##*$'\n'}; out=${out%$'\n'*}
  if [[ $code == "$want" ]] && { [[ $assert == true ]] || jq -e "$assert" >/dev/null 2>&1 <<<"$out"; }; then pass=$((pass+1)); echo "PASS $name"
  else fail=$((fail+1)); echo "FAIL $name (status $code, want $want) assert: $assert"; echo "     ${out:0:400}"; fi
  LAST=$out
}
OOS=$(psqlq "select id from product_variants where sku='DEMO-01-XS-IVO'")
INS=$(psqlq "select v.id from product_variants v where v.sku='DEMO-02-S-IVO'")
INS2=$(psqlq "select v.id from product_variants v where v.sku like 'DEMO-03-%' order by sku limit 1")
NOPE=00000000-0000-4000-8000-00000000dead
NOSTOCK_FIELDS='[.. | objects | keys[]] | map(select(test("stock|onHand|reserved"; "i"))) | length == 0'

# ---- GET /products ----
check "products list default"        200 "(.data|length)==12 and .page.limit==24 and .page.cursor==null and ($NOSTOCK_FIELDS)" GET "/products"
check "products page 1 (limit 5)"    200 '.data|length==5' GET "/products?limit=5"; C1=$(jq -r .page.cursor <<<"$LAST"); P1=$(jq -c '[.data[].id]' <<<"$LAST")
check "products page 2 (cursor)"     200 "(.data|length)==5 and ([.data[].id] - $P1 | length)==5" GET "/products?limit=5&cursor=$C1"
check "products sort price_asc"      200 '[.data[].priceFromMinor] as $p | $p == ($p|sort)' GET "/products?sort=price_asc"
check "products sort price_desc"     200 '[.data[].priceFromMinor] as $p | $p == ($p|sort|reverse)' GET "/products?sort=price_desc"
check "products price paging"        200 '.data|length==4' GET "/products?sort=price_asc&limit=4"; C2=$(jq -r .page.cursor <<<"$LAST"); MAXP=$(jq '[.data[].priceFromMinor]|max' <<<"$LAST")
check "products price paging p2"     200 "[.data[].priceFromMinor]|min >= $MAXP" GET "/products?sort=price_asc&limit=4&cursor=$C2"
check "products category=footwear"   200 '(.data|length)>0 and all(.data[]; .categorySlug=="footwear")' GET "/products?category=footwear"
check "products unknown category"    200 '.data==[]' GET "/products?category=no-such-cat"
check "products size=M"              200 '(.data|length)>0' GET "/products?size=M"
check "products colour filter"       200 '(.data|length)>0' GET "/products?colour=ivory"
check "products min/max price"       200 'all(.data[]; .priceFromMinor>=50000000 and .priceFromMinor<=150000000)' GET "/products?minPrice=50000000&maxPrice=150000000"
check "products locale fallback uz"  200 '.data|length==12' GET "/products?locale=uz"
check "products 400 bad sort"        400 '.error.code=="VALIDATION_ERROR"' GET "/products?sort=cheap"
check "products 400 limit>100"       400 '.error.code=="VALIDATION_ERROR"' GET "/products?limit=101"
check "products 400 bad locale"      400 '.error.code=="VALIDATION_ERROR"' GET "/products?locale=de"
check "products 400 bad cursor"      400 '.error.code=="VALIDATION_ERROR"' GET "/products?cursor=garbage"
check "products 400 min>max"         400 '.error.code=="VALIDATION_ERROR"' GET "/products?minPrice=10&maxPrice=1"
check "products 400 dup param"       400 '.error.code=="VALIDATION_ERROR"' GET "/products?sort=new&sort=price_asc"
check "products 400 bad category"    400 '.error.code=="VALIDATION_ERROR"' GET "/products?category=Bad%20Slug"
# ---- GET /products/{slug} ----
check "product detail"               200 ".data.slug==\"demo-linen-wrap-dress\" and (.data.variants|length)>0 and (.data.images|length)>0 and any(.data.variants[]; .available==false) and ($NOSTOCK_FIELDS) and ([.data.variants[]|keys[]]|map(select(test(\"ikpu|vat|package\")))|length==0)" GET "/products/demo-linen-wrap-dress"
check "product 404"                  404 '.error.code=="NOT_FOUND"' GET "/products/no-such-product"
check "product 400 bad slug"         400 '.error.code=="VALIDATION_ERROR"' GET "/products/Bad_Slug"
check "product 400 bad locale"       400 '.error.code=="VALIDATION_ERROR"' GET "/products/demo-linen-wrap-dress?locale=xx"
psqlq "update products set status='draft' where slug='demo-silk-scarf'" >/dev/null
check "draft product hidden (404)"   404 '.error.code=="NOT_FOUND"' GET "/products/demo-silk-scarf"
check "draft product not listed"     200 'all(.data[]; .slug!="demo-silk-scarf") and (.data|length)==11' GET "/products"
psqlq "update products set status='published' where slug='demo-silk-scarf'" >/dev/null
# ---- facets ----
check "facets"                       200 '(.data.sizes|length)>0 and (.data.colours|length)>0 and .data.priceMinor.currency=="UZS" and .data.sizes[0].value=="XS"' GET "/products/facets"
check "facets by category"           200 'all(.data.sizes[]; .sizeSystem=="eu_shoe")' GET "/products/facets?category=footwear"
check "facets unknown category"      200 '.data.priceMinor==null and .data.sizes==[]' GET "/products/facets?category=nope"
check "facets 400"                   400 '.error.code=="VALIDATION_ERROR"' GET "/products/facets?category=NOPE!"
# ---- categories ----
check "categories"                   200 '[.data[].slug]==["clothing","footwear","accessories"] and all(.data[]; .children==[])' GET "/categories"
check "categories locale fallback"   200 '.data[0].name=="Clothing"' GET "/categories?locale=ru"
check "categories 400"               400 '.error.code=="VALIDATION_ERROR"' GET "/categories?locale=fr"
# ---- search ----
check "search product prefix"        200 'any(.data[]; .type=="product" and .product.slug=="demo-linen-wrap-dress")' GET "/search?q=line"
check "search article"               200 'any(.data[]; .type=="article")' GET "/search?q=atelier"
check "search limit"                 200 '(.data|length)<=1' GET "/search?q=demo&limit=1"
check "search no hits / injection"   200 '.data==[]' GET "/search?q=%27%3B%20drop%20table%20products%3B%20--zzzz"
check "search tsquery syntax safe"   200 '.data|type=="array"' GET "/search?q=a%26%7C%21%3A*(b"
check "search 400 short q"           400 '.error.code=="VALIDATION_ERROR"' GET "/search?q=a"
check "search 400 missing q"         400 '.error.code=="VALIDATION_ERROR"' GET "/search"
check "search 400 limit>50"          400 '.error.code=="VALIDATION_ERROR"' GET "/search?q=dress&limit=51"
# ---- articles ----
check "articles list"                200 '(.data|length)==3 and all(.data[]; (.tags|type)=="array")' GET "/articles"
check "articles paging"              200 '.data|length==2' GET "/articles?limit=2"; C3=$(jq -r .page.cursor <<<"$LAST")
check "articles paging p2"           200 '(.data|length)==1 and .page.cursor==null' GET "/articles?limit=2&cursor=$C3"
TAG=$(psqlq "select slug from tags order by slug limit 1")
check "articles by tag"              200 "all(.data[]; any(.tags[]; .slug==\"$TAG\"))" GET "/articles?tag=$TAG"
check "articles 400"                 400 '.error.code=="VALIDATION_ERROR"' GET "/articles?limit=0"
ASLUG=$(psqlq "select slug from storefront_articles a join article_products ap on ap.article_id=a.id limit 1")
DRAFT=$(psqlq "select slug from articles where status='draft' limit 1")
check "article detail"               200 '.data.body.type=="doc" and (.data.products|length)>0' GET "/articles/$ASLUG"
check "article draft 404"            404 '.error.code=="NOT_FOUND"' GET "/articles/$DRAFT"
check "article 404"                  404 '.error.code=="NOT_FOUND"' GET "/articles/no-such-article"
check "article 400"                  400 '.error.code=="VALIDATION_ERROR"' GET "/articles/BAD%20SLUG"
# ---- cart/validate ----
check "cart ok"                      200 ".data.allAvailable==true and .data.currency==\"UZS\" and .data.lines[0].quantity==2 and .data.subtotalMinor==(.data.lines|map(.lineTotalMinor)|add) and .data.lines[0].maxQuantity<=10 and ($NOSTOCK_FIELDS)" POST "/cart/validate" "{\"items\":[{\"variantId\":\"$INS\",\"quantity\":2},{\"variantId\":\"$INS2\",\"quantity\":1}]}"
check "cart out_of_stock"            200 ".data.allAvailable==false and .data.lines[0].issue==\"out_of_stock\" and .data.lines[0].quantity==0 and .data.lines[0].maxQuantity==0" POST "/cart/validate" "{\"items\":[{\"variantId\":\"$OOS\",\"quantity\":1}]}"
psqlq "select adjust_stock('$INS2', 2-(stock_on_hand-stock_reserved), 'adjustment', 'smoke', null) from product_variants where id='$INS2' and stock_on_hand-stock_reserved<>2" >/dev/null
check "cart insufficient_stock"      200 ".data.lines[0].issue==\"insufficient_stock\" and .data.lines[0].maxQuantity==2 and .data.lines[0].quantity==2" POST "/cart/validate" "{\"items\":[{\"variantId\":\"$INS2\",\"quantity\":5}]}"
psqlq "update product_variants set is_active=false where id='$INS2'" >/dev/null
check "cart inactive"                200 ".data.lines[0].issue==\"inactive\" and .data.lines[0].available==false" POST "/cart/validate" "{\"items\":[{\"variantId\":\"$INS2\",\"quantity\":1}]}"
psqlq "update product_variants set is_active=true where id='$INS2'" >/dev/null
check "cart not_found"               200 ".data.lines[0].issue==\"not_found\"" POST "/cart/validate" "{\"items\":[{\"variantId\":\"$NOPE\",\"quantity\":1}]}"
check "cart 400 qty 0"               400 '.error.code=="VALIDATION_ERROR"' POST "/cart/validate" "{\"items\":[{\"variantId\":\"$INS\",\"quantity\":0}]}"
check "cart 400 qty 11"              400 '.error.code=="VALIDATION_ERROR"' POST "/cart/validate" "{\"items\":[{\"variantId\":\"$INS\",\"quantity\":11}]}"
check "cart 400 duplicate"           400 '.error.code=="VALIDATION_ERROR"' POST "/cart/validate" "{\"items\":[{\"variantId\":\"$INS\",\"quantity\":1},{\"variantId\":\"$INS\",\"quantity\":1}]}"
check "cart 400 empty"               400 '.error.code=="VALIDATION_ERROR"' POST "/cart/validate" '{"items":[]}'
check "cart 400 bad uuid"            400 '.error.code=="VALIDATION_ERROR"' POST "/cart/validate" '{"items":[{"variantId":"x","quantity":1}]}'
check "cart 400 malformed json"      400 '.error.code=="VALIDATION_ERROR"' POST "/cart/validate" '{"items":'
check "cart 400 wrong content-type"  400 '.error.code=="VALIDATION_ERROR"' POST "/cart/validate" '{"items":[]}' "text/plain"
check "cart 405 GET"                 405 'true' GET "/cart/validate"
# ---- shipping/options ----
check "shipping UZ"                  200 '.data.country=="UZ" and .data.currency=="UZS" and (.data.options|length)==1 and .data.options[0].priceMinor==3000000' GET "/shipping/options?country=UZ"
check "shipping UZ free over"        200 '.data.options[0].priceMinor==0 and .data.options[0].freeOverMinor==100000000' GET "/shipping/options?country=UZ&subtotalMinor=100000000"
check "shipping 422 DE"              422 '.error.code=="COUNTRY_NOT_SHIPPABLE" and .error.details.country=="DE"' GET "/shipping/options?country=DE"
check "shipping 400 lowercase"       400 '.error.code=="VALIDATION_ERROR"' GET "/shipping/options?country=uz"
check "shipping 400 missing"         400 '.error.code=="VALIDATION_ERROR"' GET "/shipping/options"
# ---- newsletter ----
EM="smoke+$RANDOM@example.com"
check "newsletter signup"            202 '.data.status=="pending_confirmation"' POST "/newsletter" "{\"email\":\"${EM^^}\"}"
[[ $(psqlq "select status from newsletter_subscribers where email='$EM'") == pending ]] && { pass=$((pass+1)); echo "PASS newsletter stored lower-case pending"; } || { fail=$((fail+1)); echo "FAIL newsletter row"; }
check "newsletter repeat (same 202)" 202 '.data.status=="pending_confirmation"' POST "/newsletter" "{\"email\":\"$EM\"}"
[[ $(psqlq "select count(*) from newsletter_subscribers where email='$EM'") == 1 ]] && { pass=$((pass+1)); echo "PASS newsletter idempotent (1 row)"; } || { fail=$((fail+1)); echo "FAIL newsletter duplicate rows"; }
check "newsletter honeypot (202, no row)" 202 '.data.status=="pending_confirmation"' POST "/newsletter" '{"email":"bot@example.com","website":"http://spam"}'
[[ $(psqlq "select count(*) from newsletter_subscribers where email='bot@example.com'") == 0 ]] && { pass=$((pass+1)); echo "PASS honeypot not stored"; } || { fail=$((fail+1)); echo "FAIL honeypot stored"; }
check "newsletter 400 bad email"     400 '.error.code=="VALIDATION_ERROR"' POST "/newsletter" '{"email":"not-an-email"}'
TOKEN=smoketoken_$(head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32)
psqlq "update newsletter_subscribers set confirm_token_hash=encode(sha256(convert_to('$TOKEN','UTF8')),'hex') where email='$EM'" >/dev/null
check "newsletter confirm"           200 '.data.status=="confirmed"' GET "/newsletter/confirm?token=$TOKEN"
check "newsletter confirm again"     200 '.data.status=="confirmed"' GET "/newsletter/confirm?token=$TOKEN"
check "newsletter confirmed stays"   202 'true' POST "/newsletter" "{\"email\":\"$EM\"}"
[[ $(psqlq "select status from newsletter_subscribers where email='$EM'") == confirmed ]] && { pass=$((pass+1)); echo "PASS re-signup keeps confirmed"; } || { fail=$((fail+1)); echo "FAIL re-signup reset confirmed"; }
check "newsletter confirm 404"       404 '.error.code=="NOT_FOUND"' GET "/newsletter/confirm?token=$(printf 'x%.0s' {1..40})"
check "newsletter confirm 400"       400 '.error.code=="VALIDATION_ERROR"' GET "/newsletter/confirm?token=short"
# rate limit: per-email (3/h) then per-IP (10/10min) — still 202, but no further writes
RUNID=$RANDOM$RANDOM
for i in $(seq 1 12); do curl -s -o /dev/null -X POST -H "$IPH" -H 'content-type: application/json' --data "{\"email\":\"rl$RUNID-$i@example.com\"}" "$BASE/newsletter"; done
[[ $(psqlq "select count(*) from newsletter_subscribers where email like 'rl$RUNID-%@example.com'") -lt 12 ]] && { pass=$((pass+1)); echo "PASS newsletter rate limit (writes capped, still 202)"; } || { fail=$((fail+1)); echo "FAIL rate limit"; }

echo "API SMOKE: $pass passed, $fail failed"
[[ $fail == 0 ]]
