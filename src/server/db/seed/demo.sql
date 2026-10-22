-- DEMO seed (dev/staging only). Owner: Backend & Database. Requires reference.sql first.
-- Everything here is removable with cleanup_demo.sql:
--   products.slug 'demo-%', SKUs 'DEMO-%', ikpu_code 'DEMO-<17 digits>' (never valid for a live fiscal receipt),
--   articles.slug 'demo-%', tags.slug 'demo-%'.
-- Prices are UZS tiyin. Stock goes in through public.adjust_stock('restock') so the ledger matches.
-- Images: DEMO placeholder paths in the 'product-images' bucket (demo/<slug>/<n>.jpg). The files are NOT uploaded
-- yet (no real photos); upload placeholders there or the storefront shows its image fallback.
do $$
declare
  p record;
  v record;
  v_pid uuid;
  v_vid uuid;
  v_cat uuid;
  v_aid uuid;
  i int := 0;
begin
  if exists (select 1 from public.product_variants where sku like 'DEMO-%') then
    raise notice 'demo seed already present, skipping (run cleanup_demo.sql first to reseed)';
    return;
  end if;

  for p in select * from (values
    -- slug, category, name, base price (tiyin), size_system, description, materials, ikpu
    ('demo-linen-wrap-dress',     'clothing',    'Linen Wrap Dress',        125000000, 'alpha',   'A relaxed wrap dress in washed linen.',            '100% linen',               'DEMO-06204400100000001'),
    ('demo-silk-slip-skirt',      'clothing',    'Silk Slip Skirt',          89000000, 'alpha',   'Bias-cut midi skirt with a soft drape.',           '100% mulberry silk',       'DEMO-06204500100000002'),
    ('demo-merino-cardigan',      'clothing',    'Merino Cardigan',          98000000, 'alpha',   'Fine-gauge cardigan with mother-of-pearl buttons.', '100% merino wool',         'DEMO-06110110100000003'),
    ('demo-wool-coat',            'clothing',    'Double-Faced Wool Coat',  350000000, 'alpha',   'Unlined, double-faced wool coat.',                 '90% wool, 10% cashmere',   'DEMO-06202110100000004'),
    ('demo-cotton-shirt',         'clothing',    'Poplin Cotton Shirt',      54000000, 'alpha',   'Crisp poplin shirt with a relaxed fit.',           '100% cotton',              'DEMO-06206300100000005'),
    ('demo-leather-loafer',       'footwear',    'Leather Loafer',          145000000, 'eu_shoe', 'Hand-finished leather loafer.',                    'Calf leather, leather sole','DEMO-06403990100000006'),
    ('demo-suede-ankle-boot',     'footwear',    'Suede Ankle Boot',        189000000, 'eu_shoe', 'Block-heel ankle boot in soft suede.',             'Suede, rubber sole',       'DEMO-06403910100000007'),
    ('demo-canvas-sneaker',       'footwear',    'Canvas Sneaker',           65000000, 'eu_shoe', 'Low-top sneaker in organic canvas.',               'Organic cotton canvas',    'DEMO-06404190100000008'),
    ('demo-mini-tote',            'accessories', 'Mini Leather Tote',       159000000, 'one_size','Structured mini tote with a detachable strap.',    'Vegetable-tanned leather', 'DEMO-04202210100000009'),
    ('demo-silk-scarf',           'accessories', 'Printed Silk Scarf',       47000000, 'one_size','Hand-rolled silk twill scarf, 90 x 90 cm.',        '100% silk twill',          'DEMO-06214000100000010'),
    ('demo-leather-belt',         'accessories', 'Leather Belt',             39000000, 'one_size','Slim belt with a brushed brass buckle.',           'Calf leather, brass',      'DEMO-04203000100000011'),
    ('demo-card-holder',          'accessories', 'Card Holder',              28000000, 'one_size','Four-slot card holder.',                           'Calf leather',             'DEMO-04231900100000012')
  ) as t(slug, cat, name, price, size_system, descr, materials, ikpu)
  loop
    i := i + 1;
    select id into v_cat from public.categories where slug = p.cat;
    insert into public.products (slug, category_id, brand, status, base_price_cents, currency, size_system,
                                 ikpu_code, package_code, vat_rate_bp, published_at)
    values (p.slug, v_cat, 'DOOYOOSH', 'published', p.price, 'UZS', p.size_system::public.size_system,
            p.ikpu, null, 1200, now() - make_interval(days => 30 - i))
    returning id into v_pid;
    insert into public.product_translations (product_id, locale, name, description, materials, care, fit_notes)
    values (v_pid, 'en', p.name, p.descr || ' (Demo product.)', p.materials, 'See care label.', null);
    insert into public.product_images (product_id, storage_path, alt, sort_order, width, height)
    values (v_pid, 'demo/' || p.slug || '/1.jpg', p.name || ' (demo image)', 0, 1200, 1500),
           (v_pid, 'demo/' || p.slug || '/2.jpg', p.name || ' detail (demo image)', 1, 1200, 1500);

    for v in
      select * from (
        select s.size, s.colour, s.hex, s.stock, s.ord from (values
          ('alpha', 'XS', 'Ivory', '#F7F1E8', 3, 1), ('alpha', 'S', 'Ivory', '#F7F1E8', 5, 2),
          ('alpha', 'M', 'Ivory', '#F7F1E8', 5, 3), ('alpha', 'L', 'Ivory', '#F7F1E8', 2, 4),
          ('eu_shoe', '37', 'Espresso', '#4A3931', 2, 1), ('eu_shoe', '38', 'Espresso', '#4A3931', 4, 2),
          ('eu_shoe', '39', 'Espresso', '#4A3931', 4, 3), ('eu_shoe', '40', 'Espresso', '#4A3931', 1, 4),
          ('one_size', null, 'Dusty Rose', '#C9A2A0', 6, 1), ('one_size', null, 'Espresso', '#4A3931', 4, 2)
        ) as s(sys, size, colour, hex, stock, ord)
        where s.sys = p.size_system
      ) x order by x.ord
    loop
      insert into public.product_variants (product_id, sku, size, colour, colour_hex, price_cents, is_active, weight_grams)
      values (v_pid, 'DEMO-' || lpad(i::text, 2, '0') || '-' || coalesce(v.size, 'OS') || '-' || upper(left(replace(v.colour, ' ', ''), 3)),
              v.size, v.colour, v.hex, null, true, case p.cat when 'footwear' then 900 when 'clothing' then 500 else 300 end)
      returning id into v_vid;
      -- one deliberately sold-out variant: Linen Wrap Dress / XS
      if not (p.slug = 'demo-linen-wrap-dress' and v.size = 'XS') then
        perform public.adjust_stock(v_vid, v.stock, 'restock', 'demo seed', null);
      end if;
    end loop;
  end loop;

  -- tags
  insert into public.tags (slug, name) values
    ('demo-editorial', 'Editorial'), ('demo-styling', 'Styling'), ('demo-atelier', 'Atelier');

  -- articles: 3 published + 1 draft
  for p in select * from (values
    ('demo-spring-edit', 'published', 'The Spring Edit', 'Light layers for the first warm days.', 'demo-editorial', 'demo-linen-wrap-dress', 10),
    ('demo-how-to-style-silk', 'published', 'How to Style Silk', 'Three ways to wear a silk slip skirt.', 'demo-styling', 'demo-silk-slip-skirt', 6),
    ('demo-inside-the-atelier', 'published', 'Inside the Atelier', 'Where our leather goods are finished by hand.', 'demo-atelier', 'demo-mini-tote', 2),
    ('demo-autumn-preview', 'draft', 'Autumn Preview (draft)', 'Not visible to the public.', 'demo-editorial', 'demo-wool-coat', 0)
  ) as t(slug, status, title, excerpt, tag, product, days_ago)
  loop
    insert into public.articles (slug, status, cover_image_path, author_name, published_at)
    values (p.slug, p.status::public.article_status,
            'demo/' || p.slug || '/cover.jpg',
            'DOOYOOSH Journal (demo)',
            case when p.status = 'published' then now() - make_interval(days => p.days_ago) end)
    returning id into v_aid;
    insert into public.article_translations (article_id, locale, title, excerpt, body, seo_title, seo_description)
    values (v_aid, 'en', p.title, p.excerpt,
            jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
              jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
                jsonb_build_object('type', 'text', 'text', p.excerpt || ' This is demo content.'))))),
            p.title || ' | DOOYOOSH', p.excerpt);
    insert into public.article_tags (article_id, tag_id) select v_aid, id from public.tags where slug = p.tag;
    insert into public.article_products (article_id, product_id, sort_order)
    select v_aid, id, 0 from public.products where slug = p.product;
  end loop;
end $$;
