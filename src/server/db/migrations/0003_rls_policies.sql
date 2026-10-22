-- 0003_rls_policies (hand-written, drizzle-kit --custom). Owner: Backend & Database.
-- RLS on every table, explicit grants, admin role matrix, public storefront views (security_invoker = on).
-- See docs/DATABASE.md "RLS matrix".

-- 1. RLS ON for every public table
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- 2. Grants. Supabase grants ALL on public tables to anon/authenticated by default: start from zero.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- public catalog / journal / shipping reads (rows filtered by the policies below)
grant select on public.categories, public.category_translations, public.size_charts, public.products,
  public.product_translations, public.product_images, public.markets, public.countries, public.shipping_methods,
  public.shipping_rates, public.articles, public.article_translations, public.article_products, public.tags,
  public.article_tags
  to anon, authenticated;
-- variants: column-level, exact stock counts are never readable by API roles (only in_stock)
grant select (id, product_id, sku, size, colour, colour_hex, price_cents, in_stock, is_active, weight_grams,
              created_at, updated_at)
  on public.product_variants to anon, authenticated;

-- admin writes through a user JWT (RLS restricts to the role matrix)
grant insert, update, delete on public.categories, public.category_translations, public.size_charts,
  public.products, public.product_translations, public.product_images, public.articles,
  public.article_translations, public.article_products, public.tags, public.article_tags,
  public.markets, public.countries, public.shipping_methods, public.shipping_rates
  to authenticated;
grant insert (product_id, sku, size, colour, colour_hex, price_cents, is_active, weight_grams),
      update (sku, size, colour, colour_hex, price_cents, is_active, weight_grams),
      delete
  on public.product_variants to authenticated;
grant select, insert, update, delete on public.admin_users to authenticated;
grant select, update (full_name) on public.profiles to authenticated;

-- service_role (server) keeps Supabase's table grants EXCEPT direct stock writes: those go through 0002 functions
revoke insert, update on public.product_variants from service_role;
grant insert (id, product_id, sku, size, colour, colour_hex, price_cents, is_active, weight_grams, created_at, updated_at),
      update (sku, size, colour, colour_hex, price_cents, is_active, weight_grams, updated_at)
  on public.product_variants to service_role;
revoke insert, update, delete, truncate on public.stock_reservations from service_role;
revoke insert, update, delete, truncate on public.inventory_movements from service_role;
grant select on public.stock_reservations, public.inventory_movements to service_role;

-- 3. Policies. Helpers:
--   app_private.is_admin()                      any active admin
--   app_private.is_admin('{editor}')            owner or editor
--   app_private.is_admin('{}')                  owner only
-- Write policies are per-command (insert/update/delete) so each role/action has ONE permissive SELECT policy.

-- categories
create policy categories_read on public.categories for select to anon, authenticated
  using (is_active or (select app_private.is_admin()));
create policy categories_ins on public.categories for insert to authenticated
  with check ((select app_private.is_admin('{editor}')));
create policy categories_upd on public.categories for update to authenticated
  using ((select app_private.is_admin('{editor}'))) with check ((select app_private.is_admin('{editor}')));
create policy categories_del on public.categories for delete to authenticated
  using ((select app_private.is_admin('{editor}')));

-- generic helper to create editor write policies
do $$
declare
  t text;
  writes jsonb := '{
    "category_translations": "editor", "size_charts": "editor", "products": "editor",
    "product_translations": "editor", "product_images": "editor", "product_variants": "editor",
    "articles": "editor", "article_translations": "editor", "article_products": "editor",
    "tags": "editor", "article_tags": "editor",
    "markets": "owner", "countries": "owner", "shipping_methods": "owner", "shipping_rates": "owner"
  }';
  roles text;
begin
  for t in select jsonb_object_keys(writes) loop
    roles := case writes->>t when 'owner' then '''{}''' else '''{editor}''' end;
    execute format('create policy %I on public.%I for insert to authenticated with check ((select app_private.is_admin(%s)))',
                   t || '_ins', t, roles);
    execute format('create policy %I on public.%I for update to authenticated using ((select app_private.is_admin(%s))) with check ((select app_private.is_admin(%s)))',
                   t || '_upd', t, roles, roles);
    execute format('create policy %I on public.%I for delete to authenticated using ((select app_private.is_admin(%s)))',
                   t || '_del', t, roles);
  end loop;
end $$;

-- reads
create policy category_translations_read on public.category_translations for select to anon, authenticated
  using (exists (select 1 from public.categories c where c.id = category_id));
create policy size_charts_read on public.size_charts for select to anon, authenticated using (true);
create policy products_read on public.products for select to anon, authenticated
  using ((status = 'published' and archived_at is null and published_at <= now())
         or (select app_private.is_admin()));
create policy product_translations_read on public.product_translations for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id));
create policy product_images_read on public.product_images for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id));
create policy product_variants_read on public.product_variants for select to anon, authenticated
  using ((is_active and exists (select 1 from public.products p where p.id = product_id))
         or (select app_private.is_admin()));
create policy markets_read on public.markets for select to anon, authenticated
  using (is_active or (select app_private.is_admin()));
create policy countries_read on public.countries for select to anon, authenticated
  using (is_shippable or (select app_private.is_admin()));
create policy shipping_methods_read on public.shipping_methods for select to anon, authenticated
  using (is_active or (select app_private.is_admin()));
create policy shipping_rates_read on public.shipping_rates for select to anon, authenticated
  using (exists (select 1 from public.shipping_methods m where m.id = shipping_method_id));
create policy articles_read on public.articles for select to anon, authenticated
  using ((status in ('published', 'scheduled') and published_at <= now())
         or (select app_private.is_admin('{editor}')));
create policy article_translations_read on public.article_translations for select to anon, authenticated
  using (exists (select 1 from public.articles a where a.id = article_id));
create policy article_products_read on public.article_products for select to anon, authenticated
  using (exists (select 1 from public.articles a where a.id = article_id));
create policy tags_read on public.tags for select to anon, authenticated using (true);
create policy article_tags_read on public.article_tags for select to anon, authenticated
  using (exists (select 1 from public.articles a where a.id = article_id));

-- admin_users (QA-03): a user may read their own row; only an active OWNER can manage admins
create policy admin_users_read on public.admin_users for select to authenticated
  using (id = (select auth.uid()) or (select app_private.is_admin('{}')));
create policy admin_users_ins on public.admin_users for insert to authenticated
  with check ((select app_private.is_admin('{}')));
create policy admin_users_upd on public.admin_users for update to authenticated
  using ((select app_private.is_admin('{}'))) with check ((select app_private.is_admin('{}')));
create policy admin_users_del on public.admin_users for delete to authenticated
  using ((select app_private.is_admin('{}')));

-- profiles: own row read/update; any admin reads all. Rows are created by the auth.users trigger.
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select app_private.is_admin()));
create policy profiles_upd on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- NO policies (server-only via service_role / DATABASE_URL): checkouts, orders, order_items, order_events,
-- payments, refunds, shipments, payment_events, stock_reservations, inventory_movements, audit_log,
-- newsletter_subscribers.

-- 4. Public storefront views (security_invoker = on: caller's RLS + column grants apply)
create view public.storefront_products with (security_invoker = on) as
select p.id, p.slug, p.category_id, c.slug as category_slug, c.kind as category_kind, p.brand,
       p.base_price_cents, p.currency, p.size_system, p.size_chart_id, p.published_at,
       (select min(coalesce(v.price_cents, p.base_price_cents)) from public.product_variants v
         where v.product_id = p.id and v.is_active) as price_from_cents,
       exists (select 1 from public.product_variants v where v.product_id = p.id and v.is_active and v.in_stock) as available
  from public.products p
  join public.categories c on c.id = p.category_id
 where p.status = 'published' and p.archived_at is null and p.published_at <= now();

create view public.storefront_variants with (security_invoker = on) as
select v.id, v.product_id, v.sku, v.size, v.colour, v.colour_hex,
       coalesce(v.price_cents, p.base_price_cents) as price_cents, p.currency, v.in_stock as available
  from public.product_variants v
  join public.products p on p.id = v.product_id
 where v.is_active and p.status = 'published' and p.archived_at is null and p.published_at <= now();

create view public.storefront_articles with (security_invoker = on) as
select a.id, a.slug, a.cover_image_path, a.author_name, a.published_at
  from public.articles a
 where a.status in ('published', 'scheduled') and a.published_at <= now();

grant select on public.storefront_products, public.storefront_variants, public.storefront_articles
  to anon, authenticated, service_role;

-- 5. Availability helper (invoker; reads only the in_stock flag the caller may see)
create or replace function public.variant_availability(p_variant_ids uuid[])
returns table (variant_id uuid, in_stock boolean)
language sql stable security invoker set search_path = '' as $$
  select v.id, v.in_stock and v.is_active
    from public.product_variants v
   where v.id = any (p_variant_ids)
$$;
revoke all on function public.variant_availability(uuid[]) from public;
grant execute on function public.variant_availability(uuid[]) to anon, authenticated, service_role;

-- 6. Facets for the shop filters (invoker: only published products / active variants the caller can see).
--    No API contract yet (Architect to add); Backend exposes the DB side only.
create or replace function public.product_facets(p_category_slug text default null)
returns table (facet text, value text, product_count bigint)
language sql stable security invoker set search_path = '' as $$
  with v as (
    select sv.product_id, sv.size, sv.colour, sp.price_from_cents
      from public.storefront_variants sv
      join public.storefront_products sp on sp.id = sv.product_id
     where p_category_slug is null or sp.category_slug = p_category_slug
  )
  select 'size', size, count(distinct product_id) from v where size is not null group by size
  union all
  select 'colour', colour, count(distinct product_id) from v where colour is not null group by colour
  order by 1, 2
$$;
revoke all on function public.product_facets(text) from public;
grant execute on function public.product_facets(text) to anon, authenticated, service_role;
