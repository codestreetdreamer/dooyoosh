-- RLS / grant tests. Portable: runs on the local emulated DB AND on Supabase, inside ONE transaction that is
-- ROLLED BACK (no data left behind). Any failure raises 'FAIL: ...' and aborts.
-- Local:    psql -X -v ON_ERROR_STOP=1 -d dooyoosh_test -f rls_test.sql
-- Supabase: same SQL through the SQL editor / MCP execute_sql (it ends with ROLLBACK).
begin;

-- ---------- fixtures (as the owner role) ----------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'rls-owner@test.invalid'),
  ('00000000-0000-4000-8000-0000000000a2', 'rls-editor@test.invalid'),
  ('00000000-0000-4000-8000-0000000000a3', 'rls-fulfil@test.invalid'),
  ('00000000-0000-4000-8000-0000000000b1', 'rls-user1@test.invalid'),
  ('00000000-0000-4000-8000-0000000000b2', 'rls-user2@test.invalid'),
  ('00000000-0000-4000-8000-0000000000c1', 'rls-new-admin@test.invalid');
insert into public.admin_users (id, role, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner', true),
  ('00000000-0000-4000-8000-0000000000a2', 'editor', true),
  ('00000000-0000-4000-8000-0000000000a3', 'fulfilment', true);

insert into public.categories (id, slug, kind, is_active) values
  ('00000000-0000-4000-8000-000000000c01', 'rlstest-cat', 'clothing', true),
  ('00000000-0000-4000-8000-000000000c02', 'rlstest-cat-hidden', 'clothing', false);
insert into public.products (id, slug, category_id, status, base_price_cents, currency, size_system, ikpu_code, published_at) values
  ('00000000-0000-4000-8000-000000000d01', 'rlstest-published', '00000000-0000-4000-8000-000000000c01', 'published', 10000000, 'UZS', 'alpha', 'DEMO-00000000000000001', now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000000d02', 'rlstest-draft', '00000000-0000-4000-8000-000000000c01', 'draft', 10000000, 'UZS', 'alpha', null, null);
insert into public.product_translations (product_id, locale, name) values
  ('00000000-0000-4000-8000-000000000d01', 'en', 'RLS published'), ('00000000-0000-4000-8000-000000000d02', 'en', 'RLS draft');
insert into public.product_variants (id, product_id, sku, size, is_active) values
  ('00000000-0000-4000-8000-000000000e01', '00000000-0000-4000-8000-000000000d01', 'RLSTEST-1', 'M', true),
  ('00000000-0000-4000-8000-000000000e02', '00000000-0000-4000-8000-000000000d02', 'RLSTEST-2', 'M', true),
  ('00000000-0000-4000-8000-000000000e03', '00000000-0000-4000-8000-000000000d01', 'RLSTEST-3', 'L', false);
select public.adjust_stock('00000000-0000-4000-8000-000000000e01', 7, 'restock', 'rls test', null);
insert into public.markets (id, code, currency, is_active) values ('00000000-0000-4000-8000-000000000f01', 'RLSTEST', 'UZS', true);
insert into public.shipping_methods (id, market_id, code, name, min_days, max_days) values
  ('00000000-0000-4000-8000-000000000f02', '00000000-0000-4000-8000-000000000f01', 'rls', 'RLS', 1, 2);
insert into public.checkouts (id, email, locale, currency, items, shipping_address, shipping_method_id,
                              subtotal_cents, shipping_cents, total_cents, provider, access_token_hash, expires_at) values
  ('00000000-0000-4000-8000-000000000f03', 'buyer@test.invalid', 'en', 'UZS', '[]', '{}', '00000000-0000-4000-8000-000000000f02',
   0, 0, 0, 'mock', 'x', now() + interval '30 min');
insert into public.orders (id, reference, checkout_id, email, locale, currency, subtotal_cents, shipping_cents, total_cents,
                           shipping_address, shipping_method_id, access_token_hash) values
  ('00000000-0000-4000-8000-000000000f04', 'DY-20261022-RLSAA', '00000000-0000-4000-8000-000000000f03', 'buyer@test.invalid', 'en', 'UZS',
   0, 0, 0, '{}', '00000000-0000-4000-8000-000000000f02', 'x');
insert into public.payment_events (provider, event_id, type) values ('mock', 'rls-evt-1', 'test');
insert into public.articles (id, slug, status, published_at) values
  ('00000000-0000-4000-8000-000000000aa1', 'rlstest-article-pub', 'published', now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000000aa2', 'rlstest-article-draft', 'draft', null),
  ('00000000-0000-4000-8000-000000000aa3', 'rlstest-article-future', 'scheduled', now() + interval '7 days');

-- ---------- static grant checks ----------
do $$
declare f text; r text;
begin
  foreach f in array array[
    'public.reserve_checkout(uuid,jsonb,timestamptz)', 'public.convert_checkout_to_order(uuid,jsonb)',
    'public.release_checkout(uuid,text)', 'public.release_expired_reservations(timestamptz,integer)',
    'public.adjust_stock(uuid,integer,public.inventory_movement_reason,text,uuid)',
    'public.restock_order(uuid,public.inventory_movement_reason,uuid,text)',
    'public.record_payment_event(public.payment_provider,text,text,jsonb)',
    'public.mark_payment_event_processed(public.payment_provider,text,text)'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'EXECUTE') then raise exception 'FAIL: % can execute %', r, f; end if;
    end loop;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'FAIL: service_role cannot execute %', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f::regprocedure) then
      raise exception 'FAIL: % is not SECURITY DEFINER with search_path=""', f;
    end if;
  end loop;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity) then
    raise exception 'FAIL: a public table has RLS disabled';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'v'
                and not coalesce(c.reloptions @> array['security_invoker=on'] or c.reloptions @> array['security_invoker=true'], false)) then
    raise exception 'FAIL: a public view is not security_invoker';
  end if;
  if has_column_privilege('anon', 'public.product_variants', 'stock_on_hand', 'SELECT')
     or has_column_privilege('authenticated', 'public.product_variants', 'stock_reserved', 'SELECT') then
    raise exception 'FAIL: API roles can read exact stock';
  end if;
  if has_table_privilege('service_role', 'public.inventory_movements', 'UPDATE')
     or has_table_privilege('service_role', 'public.inventory_movements', 'DELETE')
     or has_column_privilege('service_role', 'public.product_variants', 'stock_on_hand', 'UPDATE') then
    raise exception 'FAIL: service_role can write ledger/stock directly';
  end if;
  raise notice 'PASS grants: 8 functions service_role-only + definer + search_path; RLS on all tables; views invoker; stock columns hidden';
end $$;

-- ---------- anon ----------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare n int; t text;
begin
  select count(*) into n from public.products where slug like 'rlstest-%';
  if n <> 1 then raise exception 'FAIL: anon sees % rlstest products (expected 1 published)', n; end if;
  select count(*) into n from public.products where status <> 'published';
  if n <> 0 then raise exception 'FAIL: anon sees drafts'; end if;
  select count(*) into n from public.product_translations where product_id = '00000000-0000-4000-8000-000000000d02';
  if n <> 0 then raise exception 'FAIL: anon sees draft translations'; end if;
  select count(*) into n from public.product_variants where sku like 'RLSTEST-%';
  if n <> 1 then raise exception 'FAIL: anon sees % RLSTEST variants (expected 1 active of published)', n; end if;
  select count(*) into n from public.product_variants where sku = 'RLSTEST-1' and in_stock;
  if n <> 1 then raise exception 'FAIL: anon cannot read in_stock'; end if;
  select count(*) into n from public.storefront_variants where sku like 'RLSTEST-%' and available;
  if n <> 1 then raise exception 'FAIL: storefront_variants'; end if;
  select count(*) into n from public.storefront_products where slug like 'rlstest-%';
  if n <> 1 then raise exception 'FAIL: storefront_products'; end if;
  select count(*) into n from public.variant_availability(array['00000000-0000-4000-8000-000000000e01'::uuid, '00000000-0000-4000-8000-000000000e02'::uuid]) where in_stock;
  if n <> 1 then raise exception 'FAIL: variant_availability returned %', n; end if;
  select count(*) into n from public.categories where slug like 'rlstest-%';
  if n <> 1 then raise exception 'FAIL: anon sees inactive category'; end if;
  select count(*) into n from public.articles where slug like 'rlstest-%';
  if n <> 1 then raise exception 'FAIL: anon sees % rlstest articles (expected 1)', n; end if;
  select count(*) into n from public.product_facets('rlstest-cat') where facet = 'size' and value = 'M' and product_count = 1;
  if n <> 1 then raise exception 'FAIL: product_facets'; end if;
  select count(*) into n from public.product_facets('rlstest-cat') where value = 'L';
  if n <> 0 then raise exception 'FAIL: product_facets counts inactive variant'; end if;
  select count(*) into n from public.markets where code = 'RLSTEST';
  if n <> 1 then raise exception 'FAIL: anon cannot read active market'; end if;

  begin perform stock_on_hand from public.product_variants limit 1; raise exception 'FAIL: anon reads stock_on_hand';
  exception when insufficient_privilege then null; end;
  foreach t in array array['checkouts','orders','order_items','order_events','payments','refunds','shipments',
                            'payment_events','stock_reservations','inventory_movements','audit_log','admin_users',
                            'profiles','newsletter_subscribers'] loop
    begin execute format('select count(*) from public.%I', t); raise exception 'FAIL: anon can select %', t;
    exception when insufficient_privilege then null; end;
  end loop;
  begin insert into public.payment_events (provider, event_id, type) values ('payme', 'attacker', 'x');
    raise exception 'FAIL: anon inserted payment_event'; exception when insufficient_privilege then null; end;
  begin insert into public.orders (reference) values ('DY-20261022-AAAAA');
    raise exception 'FAIL: anon inserted order'; exception when insufficient_privilege then null; end;
  begin update public.product_variants set stock_reserved = 0 where sku = 'RLSTEST-1';
    raise exception 'FAIL: anon updated stock'; exception when insufficient_privilege then null; end;
  begin insert into public.products (slug, category_id, base_price_cents, currency, size_system)
    values ('rlstest-anon', '00000000-0000-4000-8000-000000000c01', 1, 'UZS', 'alpha');
    raise exception 'FAIL: anon inserted product'; exception when insufficient_privilege then null; end;
  begin perform public.reserve_checkout('00000000-0000-4000-8000-000000000f03', '[]', now());
    raise exception 'FAIL: anon executed reserve_checkout'; exception when insufficient_privilege then null; end;
  begin perform public.adjust_stock('00000000-0000-4000-8000-000000000e01', 1, 'restock', null, null);
    raise exception 'FAIL: anon executed adjust_stock'; exception when insufficient_privilege then null; end;
  begin perform public.convert_checkout_to_order('00000000-0000-4000-8000-000000000f03', '{}');
    raise exception 'FAIL: anon executed convert'; exception when insufficient_privilege then null; end;
  begin perform public.record_payment_event('payme', 'x', 'y', null);
    raise exception 'FAIL: anon executed record_payment_event'; exception when insufficient_privilege then null; end;
  raise notice 'PASS anon: published-only catalog/journal, no stock counts, no orders/checkouts/payments/events, no writes, no stock functions';
end $$;
reset role;

-- ---------- authenticated, non-admin ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
do $$
declare n int; t text;
begin
  select count(*) into n from public.products where slug like 'rlstest-%';
  if n <> 1 then raise exception 'FAIL: user sees drafts (% products)', n; end if;
  foreach t in array array['checkouts','orders','order_items','payments','payment_events','stock_reservations',
                            'inventory_movements','audit_log','newsletter_subscribers'] loop
    begin execute format('select count(*) from public.%I', t); raise exception 'FAIL: user can select %', t;
    exception when insufficient_privilege then null; end;
  end loop;
  -- QA-03: no self-promotion
  begin insert into public.admin_users (id, role) values ('00000000-0000-4000-8000-0000000000b1', 'owner');
    raise exception 'FAIL: user self-assigned admin'; exception when insufficient_privilege then null; end;
  select count(*) into n from public.admin_users;
  if n <> 0 then raise exception 'FAIL: user sees admin_users rows'; end if;
  -- profiles: own only
  select count(*) into n from public.profiles where email like 'rls-%';
  if n <> 1 then raise exception 'FAIL: user sees % profiles (expected own only)', n; end if;
  update public.profiles set full_name = 'Me' where id = '00000000-0000-4000-8000-0000000000b1';
  get diagnostics n = row_count; if n <> 1 then raise exception 'FAIL: user cannot update own profile'; end if;
  update public.profiles set full_name = 'Hacked' where id = '00000000-0000-4000-8000-0000000000b2';
  get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: user updated another profile'; end if;
  begin update public.profiles set email = 'x@y.z' where id = '00000000-0000-4000-8000-0000000000b1';
    raise exception 'FAIL: user changed own profile email'; exception when insufficient_privilege then null; end;
  begin insert into public.products (slug, category_id, base_price_cents, currency, size_system)
    values ('rlstest-user', '00000000-0000-4000-8000-000000000c01', 1, 'UZS', 'alpha');
    raise exception 'FAIL: user inserted product'; exception when insufficient_privilege then null; end;
  begin perform public.release_expired_reservations();
    raise exception 'FAIL: user executed release_expired_reservations'; exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name) values ('product-images', 'rlstest/user.jpg');
    raise exception 'FAIL: user uploaded media'; exception when insufficient_privilege then null; end;
  raise notice 'PASS authenticated non-admin: no drafts, no server tables, no self-admin, own profile only, no media upload';
end $$;
reset role;

-- ---------- editor ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.products where slug like 'rlstest-%';
  if n <> 2 then raise exception 'FAIL: editor sees % products (expected 2 incl. draft)', n; end if;
  select count(*) into n from public.articles where slug like 'rlstest-%';
  if n <> 3 then raise exception 'FAIL: editor sees % articles (expected 3)', n; end if;
  insert into public.products (slug, category_id, base_price_cents, currency, size_system)
  values ('rlstest-editor', '00000000-0000-4000-8000-000000000c01', 1, 'UZS', 'alpha');
  update public.products set brand = 'Edited' where slug = 'rlstest-draft';
  get diagnostics n = row_count; if n <> 1 then raise exception 'FAIL: editor cannot update product'; end if;
  insert into public.product_variants (product_id, sku, size) values ('00000000-0000-4000-8000-000000000d02', 'RLSTEST-ED', 'S');
  begin update public.product_variants set stock_on_hand = 100 where sku = 'RLSTEST-ED';
    raise exception 'FAIL: editor wrote stock directly'; exception when insufficient_privilege then null; end;
  insert into public.articles (slug, status) values ('rlstest-editor-article', 'draft');
  insert into storage.objects (bucket_id, name) values ('product-images', 'rlstest/editor.jpg');
  begin insert into public.markets (code, currency) values ('RLSX', 'UZS');
    raise exception 'FAIL: editor created market'; exception when insufficient_privilege then null; end;
  begin insert into public.admin_users (id, role) values ('00000000-0000-4000-8000-0000000000c1', 'editor');
    raise exception 'FAIL: editor managed admins'; exception when insufficient_privilege then null; end;
  begin perform count(*) from public.orders; raise exception 'FAIL: editor reads orders';
  exception when insufficient_privilege then null; end;
  begin perform public.adjust_stock('00000000-0000-4000-8000-000000000e01', 1, 'restock', null, null);
    raise exception 'FAIL: editor executed adjust_stock'; exception when insufficient_privilege then null; end;
  raise notice 'PASS editor: drafts + product/article/variant/media writes; no stock, markets, admins, orders';
end $$;
reset role;

-- ---------- fulfilment ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.products where slug like 'rlstest-%';
  if n < 2 then raise exception 'FAIL: fulfilment cannot read draft products'; end if;
  begin insert into public.products (slug, category_id, base_price_cents, currency, size_system)
    values ('rlstest-ful', '00000000-0000-4000-8000-000000000c01', 1, 'UZS', 'alpha');
    raise exception 'FAIL: fulfilment inserted product'; exception when insufficient_privilege then null; end;
  update public.products set brand = 'x' where slug = 'rlstest-draft';
  get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: fulfilment updated product'; end if;
  begin insert into storage.objects (bucket_id, name) values ('product-images', 'rlstest/ful.jpg');
    raise exception 'FAIL: fulfilment uploaded media'; exception when insufficient_privilege then null; end;
  select count(*) into n from public.articles where slug = 'rlstest-article-draft';
  if n <> 0 then raise exception 'FAIL: fulfilment sees draft articles'; end if;
  begin perform count(*) from public.orders; raise exception 'FAIL: fulfilment reads orders directly';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS fulfilment: read-only catalog incl. drafts; orders/shipments/inventory only via server (service_role)';
end $$;
reset role;

-- ---------- owner ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
do $$
declare n int;
begin
  insert into public.admin_users (id, role) values ('00000000-0000-4000-8000-0000000000c1', 'editor');
  select count(*) into n from public.admin_users where id::text like '00000000-0000-4000-8000-0000000000%';
  if n <> 4 then raise exception 'FAIL: owner sees % admins', n; end if;
  insert into public.markets (code, currency) values ('RLSX', 'UZS');
  update public.shipping_methods set name = 'RLS2' where code = 'rls';
  get diagnostics n = row_count; if n <> 1 then raise exception 'FAIL: owner cannot update shipping'; end if;
  select count(*) into n from public.profiles where email like 'rls-%';
  if n <> 6 then raise exception 'FAIL: owner sees % profiles (expected 6)', n; end if;
  insert into public.products (slug, category_id, base_price_cents, currency, size_system)
  values ('rlstest-owner', '00000000-0000-4000-8000-000000000c01', 1, 'UZS', 'alpha');
  insert into storage.objects (bucket_id, name) values ('product-images', 'rlstest/owner.jpg');
  begin perform count(*) from public.payments; raise exception 'FAIL: owner reads payments directly';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS owner: admins, markets/shipping, catalog, media, all profiles; payments only via server';
end $$;
reset role;

-- deactivated admin loses access
update public.admin_users set is_active = false where id = '00000000-0000-4000-8000-0000000000a2';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.products where slug = 'rlstest-draft';
  if n <> 0 then raise exception 'FAIL: inactive editor still sees drafts'; end if;
  raise notice 'PASS inactive admin treated as normal user';
end $$;
reset role;

do $$ begin raise notice 'ALL RLS TESTS PASSED'; end $$;
rollback;
