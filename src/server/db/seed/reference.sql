-- Reference seed (safe for every environment, idempotent). Owner: Backend & Database.
-- Market UZ / UZS, country UZ, the three launch categories (English), one PLACEHOLDER shipping method + rate.
-- Ids are deterministic UUID v5 (seed_ids.py: uuid5(NS, '<kind>:<key>')), so reseeding keeps the same ids.
-- Money in minor units of the market currency (UZS tiyin: 1 so'm = 100 tiyin).

insert into public.markets (id, code, currency, is_active) values ('cc192add-d3d6-501e-8747-f87705cc4325', 'UZ', 'UZS', true)
on conflict (code) do update set currency = excluded.currency, is_active = excluded.is_active;

insert into public.countries (iso2, market_id, is_shippable)
select 'UZ', m.id, true from public.markets m where m.code = 'UZ'
on conflict (iso2) do update set market_id = excluded.market_id, is_shippable = excluded.is_shippable;

insert into public.categories (id, slug, kind, sort_order, is_active) values
  ('f13d4b80-aa63-5cba-810a-cb1a3b0c68b3', 'clothing', 'clothing', 10, true),
  ('acb422b4-65f4-5e61-8436-73032dba0874', 'footwear', 'footwear', 20, true),
  ('328295ab-81f9-5121-bb56-7fe2de74c09d', 'accessories', 'accessories', 30, true)
on conflict (slug) do nothing;

insert into public.category_translations (category_id, locale, name, description)
select c.id, 'en', t.name, t.description
  from (values ('clothing', 'Clothing', 'Dresses, knitwear, outerwear and everyday pieces.'),
               ('footwear', 'Footwear', 'Shoes and boots.'),
               ('accessories', 'Accessories', 'Bags, scarves and small leather goods.')) as t(slug, name, description)
  join public.categories c on c.slug = t.slug
on conflict (category_id, locale) do nothing;

-- PLACEHOLDER: carrier and prices are an open decision (spec §10.4). Replace before launch.
insert into public.shipping_methods (id, market_id, code, name, min_days, max_days, is_active)
select '5c48658c-bf15-5f5e-a5f1-e194a33d0377', m.id, 'placeholder-standard', 'PLACEHOLDER Standard delivery (Uzbekistan)', 2, 5, true
  from public.markets m where m.code = 'UZ'
on conflict (market_id, code) do nothing;

insert into public.shipping_rates (id, shipping_method_id, min_subtotal_cents, max_weight_grams, price_cents, free_over_cents)
select 'f50d0fbc-c847-5a0f-ae8b-7422b4f2c671', sm.id, 0, null, 3000000, 100000000   -- 30 000 so'm, free over 1 000 000 so'm (placeholder numbers)
  from public.shipping_methods sm
 where sm.code = 'placeholder-standard'
   and not exists (select 1 from public.shipping_rates r where r.shipping_method_id = sm.id);
