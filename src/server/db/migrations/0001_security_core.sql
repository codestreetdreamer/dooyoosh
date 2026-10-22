-- 0001_security_core (hand-written, drizzle-kit --custom). Owner: Backend & Database.
-- Supabase hardening, auth.users FKs, triggers (updated_at, append-only ledger, stock guard), admin helper.

-- 1. Private schema for helpers that RLS policies call. Not exposed through the Data API.
create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to anon, authenticated, service_role;

-- 2. Future objects in public are NOT auto-exposed to anon/authenticated (Supabase grants ALL by default).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema app_private revoke execute on functions from public, anon, authenticated;

-- 3. FKs to Supabase Auth
alter table public.admin_users
  add constraint admin_users_id_auth_fk foreign key (id) references auth.users(id) on delete cascade;
alter table public.profiles
  add constraint profiles_id_auth_fk foreign key (id) references auth.users(id) on delete cascade;

-- 4. updated_at maintained by the DB too (Drizzle's $onUpdate only covers ORM writes)
create or replace function app_private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger products_set_updated_at before update on public.products for each row execute function app_private.set_updated_at();
create trigger product_variants_set_updated_at before update on public.product_variants for each row execute function app_private.set_updated_at();
create trigger orders_set_updated_at before update on public.orders for each row execute function app_private.set_updated_at();
create trigger articles_set_updated_at before update on public.articles for each row execute function app_private.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles for each row execute function app_private.set_updated_at();

-- 5. inventory_movements is append-only.
--    Single exception: the DEMO cleanup script may delete ledger rows of DEMO- variants when it sets
--    `dooyoosh.purge_demo = on` for its own transaction.
create or replace function app_private.inventory_movements_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE'
     and current_setting('dooyoosh.purge_demo', true) = 'on'
     and exists (select 1 from public.product_variants v where v.id = old.variant_id and v.sku like 'DEMO-%') then
    return old;
  end if;
  raise exception 'inventory_movements is append-only (% not allowed)', tg_op using errcode = '42501';
end $$;
create trigger inventory_movements_no_update before update on public.inventory_movements
  for each row execute function app_private.inventory_movements_append_only();
create trigger inventory_movements_no_delete before delete on public.inventory_movements
  for each row execute function app_private.inventory_movements_append_only();
create or replace function app_private.inventory_movements_no_truncate() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'inventory_movements is append-only (TRUNCATE not allowed)' using errcode = '42501';
end $$;
create trigger inventory_movements_no_truncate before truncate on public.inventory_movements
  for each statement execute function app_private.inventory_movements_no_truncate();
revoke update, delete, truncate on public.inventory_movements from public, anon, authenticated, service_role;

-- 6. Stock columns: no direct writes except by the table owner (the SECURITY DEFINER functions in 0002).
--    anon/authenticated/service_role get column-level grants in 0003 that exclude stock_on_hand/stock_reserved.

-- 7. Admin helper used by RLS policies. SECURITY DEFINER so it can read admin_users regardless of RLS.
--    p_roles null = any active admin. 'owner' always passes.
create or replace function app_private.is_admin(p_roles public.admin_role[] default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_users a
    where a.id = (select auth.uid())
      and a.is_active
      and (p_roles is null or a.role = 'owner' or a.role = any (p_roles))
  )
$$;
revoke all on function app_private.is_admin(public.admin_role[]) from public;
grant execute on function app_private.is_admin(public.admin_role[]) to anon, authenticated, service_role;

-- 8. Profile row for every new auth user
create or replace function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
revoke all on function app_private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();

revoke all on function app_private.set_updated_at() from public, anon, authenticated;
revoke all on function app_private.inventory_movements_append_only() from public, anon, authenticated;
revoke all on function app_private.inventory_movements_no_truncate() from public, anon, authenticated;
