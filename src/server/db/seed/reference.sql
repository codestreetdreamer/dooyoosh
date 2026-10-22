-- Reference seed (safe for every environment, idempotent). Owner: Backend & Database.
-- Market UZ / UZS, country UZ, the three launch categories (English), one PLACEHOLDER shipping method + rate.
-- Money in minor units of the market currency (UZS tiyin: 1 so'm = 100 tiyin).

insert into public.markets (code, currency, is_active) values ('UZ', 'UZS', true)
on conflict (code) do update set currency = excluded.currency, is_active = excluded.is_active;

insert into public.countries (iso2, market_id, is_shippable)
select 'UZ', m.id, true from public.markets m where m.code = 'UZ'
on conflict (iso2) do update set market_id = excluded.market_id, is_shippable = excluded.is_shippable;

insert into public.categories (slug, kind, sort_order, is_active) values
  ('clothing', 'clothing', 10, true),
  ('footwear', 'footwear', 20, true),
  ('accessories', 'accessories', 30, true)
on conflict (slug) do nothing;

insert into public.category_translations (category_id, locale, name, description)
select c.id, 'en', t.name, t.description
  from (values ('clothing', 'Clothing', 'Dresses, knitwear, outerwear and everyday pieces.'),
               ('footwear', 'Footwear', 'Shoes and boots.'),
               ('accessories', 'Accessories', 'Bags, scarves and small leather goods.')) as t(slug, name, description)
  join public.categories c on c.slug = t.slug
on conflict (category_id, locale) do nothing;

-- PLACEHOLDER: carrier and prices are an open decision (spec §10.4). Replace before launch.
insert into public.shipping_methods (market_id, code, name, min_days, max_days, is_active)
select m.id, 'placeholder-standard', 'PLACEHOLDER Standard delivery (Uzbekistan)', 2, 5, true
  from public.markets m where m.code = 'UZ'
on conflict (market_id, code) do nothing;

insert into public.shipping_rates (shipping_method_id, min_subtotal_cents, max_weight_grams, price_cents, free_over_cents)
select sm.id, 0, null, 3000000, 100000000   -- 30 000 so'm, free over 1 000 000 so'm (placeholder numbers)
  from public.shipping_methods sm
 where sm.code = 'placeholder-standard'
   and not exists (select 1 from public.shipping_rates r where r.shipping_method_id = sm.id);
