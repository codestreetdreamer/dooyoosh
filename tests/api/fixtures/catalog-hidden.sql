-- QA fixture: hidden catalog rows for published-only / stock-leak attacks.
-- Requires demo seed (slug demo-linen-wrap-dress). Apply in the same psql -1 session as demo.sql or after it.
do $$
declare src uuid; nid uuid; k text; st text; pub timestamptz; arch timestamptz;
begin
  select id into src from products where slug='demo-linen-wrap-dress';
  if src is null then
    raise exception 'catalog-hidden.sql: demo product demo-linen-wrap-dress not found (seed demo.sql first, with psql -1)';
  end if;
  foreach k in array array['draft','archived','scheduled','inactivecat'] loop
    st := case k when 'draft' then 'draft' else 'published' end;
    pub := case k when 'draft' then null when 'scheduled' then now() + interval '30 days' else now() - interval '1 day' end;
    arch := case k when 'archived' then now() - interval '1 hour' else null end;
    insert into products (slug, category_id, brand, status, base_price_cents, currency, size_system, ikpu_code, vat_rate_bp, published_at, archived_at)
      select 'qa-hidden-'||k, category_id, brand, st::product_status, 999900, currency, size_system, ikpu_code, 1200, pub, arch from products where id=src
      returning id into nid;
    insert into product_translations (product_id, locale, name, description)
      select nid, locale, 'Qahiddensecret '||k, 'qahiddensecret body '||k from product_translations where product_id=src;
    insert into product_variants (product_id, sku, size, colour, colour_hex, stock_on_hand, is_active)
      values (nid, 'QA-HIDDEN-'||upper(k), 'M', 'Ivory', '#FFFFFF', 7, true);
  end loop;
  update products set status='published' where slug='qa-hidden-archived';
  insert into categories (slug, kind, is_active, sort_order) values ('qa-inactive-cat','clothing',false,99)
    on conflict (slug) do nothing;
  update products set category_id=(select id from categories where slug='qa-inactive-cat') where slug='qa-hidden-inactivecat';
  insert into product_variants (product_id, sku, size, colour, stock_on_hand, is_active)
    values (src, 'QA-INACTIVE-VAR', 'XXL', 'Qahiddencolour', 5, false)
    on conflict (sku) do nothing;
  update product_variants set stock_on_hand=137 where id=(select id from product_variants where product_id=src and is_active order by sku limit 1);
  insert into articles (slug, status, author_name, published_at) values
    ('qa-hidden-article-draft','draft','QA',null),
    ('qa-hidden-article-scheduled','published','QA', now()+interval '30 days')
    on conflict (slug) do nothing;
  insert into article_translations (article_id, locale, title, excerpt, body)
    select a.id, l.locale, 'Qahiddensecret article '||a.slug, 'qahiddensecret excerpt',
           '[{"type":"paragraph","text":"qahiddensecret"}]'::jsonb
      from articles a
      cross join (select distinct locale from article_translations) l
     where a.slug like 'qa-hidden-article-%'
       and not exists (select 1 from article_translations t where t.article_id=a.id and t.locale=l.locale);
end $$;
