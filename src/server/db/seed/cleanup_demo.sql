-- Removes ALL demo data created by demo.sql (and any demo orders/checkouts made while testing on staging).
-- Run as the DB owner (postgres / DATABASE_URL), in one transaction:  psql "$DATABASE_URL" -1 -f cleanup_demo.sql
-- Ledger rows of DEMO- variants are deleted via the guarded `dooyoosh.purge_demo` switch (see 0001).
set local dooyoosh.purge_demo = 'on';

create temp table _demo_variants on commit drop as
  select v.id from public.product_variants v where v.sku like 'DEMO-%';
create temp table _demo_orders on commit drop as
  select distinct oi.order_id as id from public.order_items oi where oi.sku like 'DEMO-%';
create temp table _demo_checkouts on commit drop as
  select distinct sr.checkout_id as id from public.stock_reservations sr where sr.variant_id in (select id from _demo_variants)
  union select o.checkout_id from public.orders o where o.id in (select id from _demo_orders);

delete from public.inventory_movements where variant_id in (select id from _demo_variants);
delete from public.refunds where payment_id in (select id from public.payments where order_id in (select id from _demo_orders));
delete from public.payments where order_id in (select id from _demo_orders);
delete from public.shipments where order_id in (select id from _demo_orders);
delete from public.order_events where order_id in (select id from _demo_orders);
delete from public.order_items where order_id in (select id from _demo_orders);
delete from public.orders where id in (select id from _demo_orders);
delete from public.stock_reservations where checkout_id in (select id from _demo_checkouts);
delete from public.checkouts where id in (select id from _demo_checkouts);

delete from public.article_tags where article_id in (select id from public.articles where slug like 'demo-%')
                                   or tag_id in (select id from public.tags where slug like 'demo-%');
delete from public.article_products where article_id in (select id from public.articles where slug like 'demo-%')
                                       or product_id in (select id from public.products where slug like 'demo-%');
delete from public.article_translations where article_id in (select id from public.articles where slug like 'demo-%');
delete from public.articles where slug like 'demo-%';
delete from public.tags where slug like 'demo-%';

delete from public.product_images where product_id in (select id from public.products where slug like 'demo-%');
delete from public.product_variants where id in (select id from _demo_variants);
delete from public.product_translations where product_id in (select id from public.products where slug like 'demo-%');
delete from public.products where slug like 'demo-%';

select
  (select count(*) from public.product_variants where sku like 'DEMO-%') as demo_variants_left,
  (select count(*) from public.products where slug like 'demo-%') as demo_products_left,
  (select count(*) from public.articles where slug like 'demo-%') as demo_articles_left;
