-- Stock/order function tests (sequential semantics). Runs in ONE transaction and ROLLS BACK.
-- Local: psql -X -v ON_ERROR_STOP=1 -d dooyoosh_test -f functions_test.sql   (also safe on Supabase)
begin;

-- helpers (session-local)
create function pg_temp.expect_error(p_sql text, p_code text) returns text language plpgsql as $$
declare msg text; det text;
begin
  begin execute p_sql;
  exception when others then
    get stacked diagnostics msg = message_text, det = pg_exception_detail;
    if msg = p_code then return coalesce(det, ''); end if;
    raise exception 'FAIL: expected % got % (%) for %', p_code, msg, det, p_sql;
  end;
  raise exception 'FAIL: expected % but succeeded: %', p_code, p_sql;
end $$;

create function pg_temp.mk_checkout(p_lines jsonb, p_provider public.payment_provider default 'mock') returns uuid
language plpgsql as $$
declare v_id uuid; v_items jsonb; v_sub bigint; v_sm uuid;
begin
  select jsonb_agg(jsonb_build_object('variantId', v.id, 'sku', v.sku, 'productName', coalesce(t.name, p.slug),
           'size', v.size, 'colour', v.colour, 'unitPriceMinor', coalesce(v.price_cents, p.base_price_cents),
           'quantity', (l->>'quantity')::int,
           'lineTotalMinor', coalesce(v.price_cents, p.base_price_cents) * (l->>'quantity')::int)),
         sum(coalesce(v.price_cents, p.base_price_cents) * (l->>'quantity')::int)
    into v_items, v_sub
    from jsonb_array_elements(p_lines) l
    join public.product_variants v on v.id = (l->>'variant_id')::uuid
    join public.products p on p.id = v.product_id
    left join public.product_translations t on t.product_id = p.id and t.locale = 'en';
  select id into v_sm from public.shipping_methods where code = 'ft-ship';
  insert into public.checkouts (email, locale, currency, items, shipping_address, shipping_method_id,
                                subtotal_cents, shipping_cents, total_cents, provider, access_token_hash, expires_at)
  values ('ft@test.invalid', 'en', 'UZS', v_items, '{"country":"UZ"}', v_sm, v_sub, 3000000, v_sub + 3000000,
          p_provider, encode(sha256(convert_to('token-' || gen_random_uuid(), 'UTF8')), 'hex'), now() + interval '30 min')
  returning id into v_id;
  return v_id;
end $$;

create function pg_temp.stock(p_sku text, out on_hand int, out reserved int) language sql as $$
  select stock_on_hand, stock_reserved from public.product_variants where sku = p_sku $$;

-- fixtures
insert into public.markets (code, currency, is_active) values ('FTEST', 'UZS', true);
insert into public.shipping_methods (market_id, code, name, min_days, max_days)
  select id, 'ft-ship', 'FT', 1, 2 from public.markets where code = 'FTEST';
insert into public.categories (slug, kind) values ('ft-cat', 'clothing');
insert into public.products (slug, category_id, status, base_price_cents, currency, size_system, ikpu_code, package_code, vat_rate_bp, published_at)
  select 'ft-prod', id, 'published', 50000000, 'UZS', 'alpha', '12345678901234567', '1500', 1200, now() - interval '1 day'
    from public.categories where slug = 'ft-cat';
insert into public.product_variants (product_id, sku, size, price_cents)
  select p.id, s.sku, s.size, s.price from public.products p,
    (values ('FT-A', 'S', null::bigint), ('FT-B', 'M', 45000000), ('FT-C', 'L', null), ('FT-D', 'XL', null)) s(sku, size, price)
   where p.slug = 'ft-prod';
select public.adjust_stock(id, case sku when 'FT-A' then 5 when 'FT-B' then 2 when 'FT-C' then 1 else 3 end, 'restock', 'ft', null)
  from public.product_variants where sku like 'FT-%';

do $$
declare
  a uuid := (select id from public.product_variants where sku = 'FT-A');
  b uuid := (select id from public.product_variants where sku = 'FT-B');
  c uuid := (select id from public.product_variants where sku = 'FT-C');
  d uuid := (select id from public.product_variants where sku = 'FT-D');
  co1 uuid; co2 uuid; co3 uuid; co4 uuid; co5 uuid;
  res jsonb; res2 jsonb; det text; n int; s record; tot bigint;
begin
  -- 1. reserve: happy path + reserved_until
  co1 := pg_temp.mk_checkout(jsonb_build_array(jsonb_build_object('variant_id', a, 'quantity', 2),
                                               jsonb_build_object('variant_id', b, 'quantity', 1)));
  perform public.reserve_checkout(co1, jsonb_build_array(jsonb_build_object('variant_id', a, 'quantity', 2),
                                                         jsonb_build_object('variant_id', b, 'quantity', 1)), now() + interval '35 min');
  s := pg_temp.stock('FT-A'); if s.on_hand <> 5 or s.reserved <> 2 then raise exception 'FAIL 1: A %/%', s.on_hand, s.reserved; end if;
  if (select reserved_until from public.checkouts where id = co1) is null then raise exception 'FAIL 1: reserved_until not set'; end if;
  -- idempotent retry
  perform public.reserve_checkout(co1, jsonb_build_array(jsonb_build_object('variant_id', b, 'quantity', 1),
                                                         jsonb_build_object('variant_id', a, 'quantity', 2)), now() + interval '35 min');
  s := pg_temp.stock('FT-A'); if s.reserved <> 2 then raise exception 'FAIL 1b: retry double-reserved'; end if;
  raise notice 'PASS 1 reserve + reserved_until + idempotent retry';

  -- 2. QA-07: qty <= 0 / non-integer / duplicates rejected
  co2 := pg_temp.mk_checkout(jsonb_build_array(jsonb_build_object('variant_id', a, 'quantity', 1)));
  perform pg_temp.expect_error(format('select public.reserve_checkout(%L, %L, now() + interval ''35 min'')', co2,
    jsonb_build_array(jsonb_build_object('variant_id', a, 'quantity', -1))), 'VALIDATION_ERROR');
  perform pg_temp.expect_error(format('select public.reserve_checkout(%L, %L, now() + interval ''35 min'')', co2,
    jsonb_build_array(jsonb_build_object('variant_id', a, 'quantity', 0))), 'VALIDATION_ERROR');
  perform pg_temp.expect_error(format('select public.reserve_checkout(%L, %L, now() + interval ''35 min'')', co2,
    jsonb_build_array(jsonb_build_object('variant_id', a, 'quantity', 1.5))), 'VALIDATION_ERROR');
  perform pg_temp.expect_error(format('select public.reserve_checkout(%L, %L, now() + interval ''35 min'')', co2,
    jsonb_build_array(jsonb_build_object('variant_id', a, 'quantity', 1), jsonb_build_object('variant_id', a, 'quantity', 1))), 'VALIDATION_ERROR');
  perform pg_temp.expect_error(format('select public.reserve_checkout(%L, %L, now() + interval ''35 min'')', co2,
    jsonb_build_array(jsonb_build_object('variant_id', a, 'quantity', 2))), 'VALIDATION_ERROR'); -- differs from snapshot
  s := pg_temp.stock('FT-A'); if s.reserved <> 2 then raise exception 'FAIL 2: stock touched by invalid call'; end if;
  raise notice 'PASS 2 QA-07 invalid quantities rejected, stock untouched';

  -- 3. OUT_OF_STOCK reports ALL failing variants, PRICE_CHANGED
  co3 := pg_temp.mk_checkout(jsonb_build_array(jsonb_build_object('variant_id', b, 'quantity', 2),
                                               jsonb_build_object('variant_id', c, 'quantity', 2)));
  det := pg_temp.expect_error(format('select public.reserve_checkout(%L, %L, now() + interval ''35 min'')', co3,
    jsonb_build_array(jsonb_build_object('variant_id', b, 'quantity', 2), jsonb_build_object('variant_id', c, 'quantity', 2))), 'OUT_OF_STOCK');
  if not (det::jsonb @> to_jsonb(array[b]) and det::jsonb @> to_jsonb(array[c])) then raise exception 'FAIL 3: detail %', det; end if;
  update public.product_variants set price_cents = 46000000 where id = b;  -- price changes after the snapshot
  co4 := pg_temp.mk_checkout(jsonb_build_array(jsonb_build_object('variant_id', d, 'quantity', 1)));
  update public.checkouts set items = jsonb_set(items, '{0,unitPriceMinor}', '1') where id = co4;
  det := pg_temp.expect_error(format('select public.reserve_checkout(%L, %L, now() + interval ''35 min'')', co4,
    jsonb_build_array(jsonb_build_object('variant_id', d, 'quantity', 1))), 'PRICE_CHANGED');
  if det::jsonb <> to_jsonb(array[d]) then raise exception 'FAIL 3b: detail %', det; end if;
  update public.product_variants set price_cents = 45000000 where id = b;
  raise notice 'PASS 3 OUT_OF_STOCK (all variant ids in DETAIL) and PRICE_CHANGED';

  -- 4. convert: amount mismatch, then paid, fiscal snapshot, idempotent
  perform pg_temp.expect_error(format('select public.convert_checkout_to_order(%L, %L)', co1,
    jsonb_build_object('provider', 'mock', 'provider_payment_id', 'pay-1', 'amount_minor', 1, 'currency', 'UZS')), 'AMOUNT_MISMATCH');
  select total_cents into tot from public.checkouts where id = co1;
  res := public.convert_checkout_to_order(co1, jsonb_build_object('provider', 'mock', 'provider_payment_id', 'pay-1',
                                                                  'amount_minor', tot, 'currency', 'UZS'));
  if res->>'status' <> 'paid' or (res->>'reference') !~ '^DY-[0-9]{8}-[A-Z2-7]{5}$' then raise exception 'FAIL 4: %', res; end if;
  s := pg_temp.stock('FT-A'); if s.on_hand <> 3 or s.reserved <> 0 then raise exception 'FAIL 4: A %/%', s.on_hand, s.reserved; end if;
  if (select access_token_hash from public.orders where id = (res->>'order_id')::uuid)
     <> (select access_token_hash from public.checkouts where id = co1) then raise exception 'FAIL 4: B1 token hash not copied'; end if;
  if exists (select 1 from public.order_items where order_id = (res->>'order_id')::uuid
              and (ikpu_code <> '12345678901234567' or package_code <> '1500' or vat_rate_bp <> 1200 or ikpu_is_demo)) then
    raise exception 'FAIL 4: fiscal snapshot'; end if;
  res2 := public.convert_checkout_to_order(co1, jsonb_build_object('provider', 'mock', 'provider_payment_id', 'pay-1',
                                                                   'amount_minor', tot, 'currency', 'UZS'));
  if res2->>'status' <> 'already_converted' or res2->>'order_id' <> res->>'order_id' then raise exception 'FAIL 4b: %', res2; end if;
  s := pg_temp.stock('FT-A'); if s.on_hand <> 3 then raise exception 'FAIL 4b: double decrement'; end if;
  select count(*) into n from public.inventory_movements where order_id = (res->>'order_id')::uuid;
  if n <> 2 then raise exception 'FAIL 4b: % sale movements', n; end if;
  raise notice 'PASS 4 convert: AMOUNT_MISMATCH, paid + reference + token hash + fiscal snapshot, idempotent repeat';

  -- 5. B16: a second succeeded payment for the same order is rejected
  begin
    insert into public.payments (order_id, provider, provider_payment_id, amount_cents, currency, status)
    values ((res->>'order_id')::uuid, 'mock', 'pay-dup', 1, 'UZS', 'succeeded');
    raise exception 'FAIL 5: second succeeded payment accepted';
  exception when unique_violation then null; end;
  raise notice 'PASS 5 B16 one succeeded payment per order';

  -- 6. QA-06: A reserves last unit of C, expires & is released, B takes it, A's late payment -> stock_conflict
  co3 := pg_temp.mk_checkout(jsonb_build_array(jsonb_build_object('variant_id', c, 'quantity', 1)));
  perform public.reserve_checkout(co3, jsonb_build_array(jsonb_build_object('variant_id', c, 'quantity', 1)), now() + interval '35 min');
  n := public.release_expired_reservations(now() + interval '36 min', 500);
  if n < 1 then raise exception 'FAIL 6: sweep released %', n; end if;
  if (select status from public.checkouts where id = co3) <> 'expired' then raise exception 'FAIL 6: checkout not expired'; end if;
  if public.release_checkout(co3, 'expired') <> 0 then raise exception 'FAIL 6: release not idempotent'; end if;
  co5 := pg_temp.mk_checkout(jsonb_build_array(jsonb_build_object('variant_id', c, 'quantity', 1)));
  perform public.reserve_checkout(co5, jsonb_build_array(jsonb_build_object('variant_id', c, 'quantity', 1)), now() + interval '35 min');
  select total_cents into tot from public.checkouts where id = co3;
  res := public.convert_checkout_to_order(co3, jsonb_build_object('provider', 'mock', 'provider_payment_id', 'pay-late',
                                                                  'amount_minor', tot, 'currency', 'UZS'));
  if res->>'status' <> 'stock_conflict' or not (res->'conflict_variant_ids' @> to_jsonb(array[c])) then raise exception 'FAIL 6: %', res; end if;
  s := pg_temp.stock('FT-C'); if s.on_hand <> 1 or s.reserved <> 1 then raise exception 'FAIL 6: B''s unit stolen %/%', s.on_hand, s.reserved; end if;
  if (select status from public.stock_reservations where checkout_id = co5) <> 'active' then raise exception 'FAIL 6: B reservation touched'; end if;
  if (select status from public.orders where id = (res->>'order_id')::uuid) <> 'stock_conflict' then raise exception 'FAIL 6: order status'; end if;
  -- B pays normally
  select total_cents into tot from public.checkouts where id = co5;
  res2 := public.convert_checkout_to_order(co5, jsonb_build_object('provider', 'mock', 'provider_payment_id', 'pay-b',
                                                                   'amount_minor', tot, 'currency', 'UZS'));
  if res2->>'status' <> 'paid' then raise exception 'FAIL 6b: %', res2; end if;
  s := pg_temp.stock('FT-C'); if s.on_hand <> 0 or s.reserved <> 0 then raise exception 'FAIL 6b'; end if;
  raise notice 'PASS 6 QA-06 late convert after release -> stock_conflict, other buyer''s reservation intact; expiry sweep + idempotent release';

  -- 7. restock_order (Payme CancelTransaction after Perform): idempotent; stock_conflict order restocks 0
  n := public.restock_order((res2->>'order_id')::uuid, 'return', null, 'payme cancel');
  if n <> 1 then raise exception 'FAIL 7: restocked %', n; end if;
  if public.restock_order((res2->>'order_id')::uuid, 'return', null, null) <> 0 then raise exception 'FAIL 7: not idempotent'; end if;
  if public.restock_order((res->>'order_id')::uuid, 'cancellation', null, null) <> 0 then raise exception 'FAIL 7: conflict order restocked'; end if;
  s := pg_temp.stock('FT-C'); if s.on_hand <> 1 then raise exception 'FAIL 7: C on_hand %', s.on_hand; end if;
  if not exists (select 1 from public.inventory_movements where order_id = (res2->>'order_id')::uuid and reason = 'return' and delta = 1) then
    raise exception 'FAIL 7: no return movement'; end if;
  raise notice 'PASS 7 restock_order: reason=return movement, idempotent, stock_conflict order restocks nothing';

  -- 8. release_checkout reasons, adjust_stock guards
  co4 := pg_temp.mk_checkout(jsonb_build_array(jsonb_build_object('variant_id', d, 'quantity', 2)));
  perform public.reserve_checkout(co4, jsonb_build_array(jsonb_build_object('variant_id', d, 'quantity', 2)), now() + interval '35 min');
  perform pg_temp.expect_error(format('select public.adjust_stock(%L, -2, ''damage'', null, null)', d), 'INSUFFICIENT_STOCK');
  perform pg_temp.expect_error(format('select public.adjust_stock(%L, -1, ''sale'', null, null)', d), 'VALIDATION_ERROR');
  perform pg_temp.expect_error(format('select public.adjust_stock(%L, 0, ''restock'', null, null)', d), 'VALIDATION_ERROR');
  perform pg_temp.expect_error(format('select public.release_checkout(%L, ''bogus'')', co4), 'VALIDATION_ERROR');
  if public.release_checkout(co4, 'payment_failed') <> 1 then raise exception 'FAIL 8: release'; end if;
  if (select status from public.checkouts where id = co4) <> 'failed' then raise exception 'FAIL 8: status'; end if;
  if public.adjust_stock(d, -3, 'damage', 'broken', null) <> 0 then raise exception 'FAIL 8: adjust'; end if;
  raise notice 'PASS 8 release reasons, adjust_stock never below reserved, sale/0 rejected';

  -- 9. ledger invariant: stock_on_hand == sum(movements) for every variant
  if exists (select 1 from public.product_variants v
              where v.stock_on_hand <> coalesce((select sum(m.delta) from public.inventory_movements m where m.variant_id = v.id), 0)) then
    raise exception 'FAIL 9: ledger mismatch'; end if;
  begin update public.inventory_movements set delta = 99 where variant_id = a; raise exception 'FAIL 9: ledger update';
  exception when insufficient_privilege then null; end;
  begin delete from public.inventory_movements where variant_id = a; raise exception 'FAIL 9: ledger delete';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS 9 ledger invariant on_hand = sum(movements); UPDATE/DELETE blocked (QA-04)';

  -- 10. payment events idempotency
  if not public.record_payment_event('payme', 'evt-1', 'PerformTransaction', '{}') then raise exception 'FAIL 10'; end if;
  if public.record_payment_event('payme', 'evt-1', 'PerformTransaction', '{}') then raise exception 'FAIL 10: dup new'; end if;
  if not public.record_payment_event('click', 'evt-1', 'Complete', '{}') then raise exception 'FAIL 10: provider scope'; end if;
  perform public.mark_payment_event_processed('payme', 'evt-1', null);
  if (select processed_at from public.payment_events where provider = 'payme' and event_id = 'evt-1') is null then raise exception 'FAIL 10: processed'; end if;
  raise notice 'PASS 10 record_payment_event dedupe per provider + mark processed';

  -- 11. IKPU / publish rules
  begin update public.products set ikpu_code = null where slug = 'ft-prod'; raise exception 'FAIL 11: published without ikpu';
  exception when check_violation then null; end;
  begin update public.products set ikpu_code = '123' where slug = 'ft-prod'; raise exception 'FAIL 11: bad ikpu';
  exception when check_violation then null; end;
  begin update public.products set published_at = null where slug = 'ft-prod'; raise exception 'FAIL 11: published without published_at';
  exception when check_violation then null; end;
  update public.products set ikpu_code = 'DEMO-12345678901234567' where slug = 'ft-prod';
  if not (select ikpu_is_demo from public.products where slug = 'ft-prod') then raise exception 'FAIL 11: ikpu_is_demo'; end if;
  raise notice 'PASS 11 IKPU format ^(DEMO-)?[0-9]{17}$, publish requires ikpu + published_at, ikpu_is_demo flag';
end $$;

do $$ begin raise notice 'ALL FUNCTION TESTS PASSED'; end $$;
rollback;
