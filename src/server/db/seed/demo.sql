-- DEMO seed (dev/staging only). Owner: Backend & Database. Requires reference.sql first.
-- Everything here is removable with cleanup_demo.sql:
--   products.slug 'demo-%', SKUs 'DEMO-%', ikpu_code 'DEMO-<17 digits>' (never valid for a live fiscal receipt),
--   articles.slug 'demo-%', tags.slug 'demo-%'.
-- Prices are UZS tiyin. Stock goes in through public.adjust_stock('restock') so the ledger matches.
-- Images: DEMO placeholder paths in the 'product-images' bucket (demo/<slug>/<n>.jpg). The files are NOT uploaded
-- yet (no real photos); upload placeholders there or the storefront shows its image fallback.
-- Ids: deterministic UUID v5 from seed_ids.py (uuid5(NS, '<kind>:<slug|sku|path>')); reseeding keeps the same ids.
create temp table seed_ids (key text primary key, id uuid not null) on commit drop;
insert into seed_ids (key, id) values
  ('product:demo-linen-wrap-dress', '9300b3fd-f7dd-5b79-8bc1-4f421b1e486b'),
  ('product_image:demo/demo-linen-wrap-dress/1.jpg', '3e13930d-6a33-5b04-8630-ed08680f3b19'),
  ('product_image:demo/demo-linen-wrap-dress/2.jpg', '8790abd3-4e3c-570d-9db5-b1603f69c3a2'),
  ('variant:DEMO-01-XS-IVO', '43f1e549-1e3f-5380-a7da-86f51bc808ca'),
  ('variant:DEMO-01-S-IVO', '3e0aae87-6826-5cca-b1d9-c79d6b8a99e2'),
  ('variant:DEMO-01-M-IVO', '0f7d3b1d-1adb-5ae8-b267-4e51378ef112'),
  ('variant:DEMO-01-L-IVO', 'c56048e2-2ede-599c-96e1-1f753f6aa8a7'),
  ('product:demo-silk-slip-skirt', 'bd7e7aba-138e-5c07-a55a-c839fd3e3cac'),
  ('product_image:demo/demo-silk-slip-skirt/1.jpg', '631891fd-e34c-594b-94d5-b0736366547e'),
  ('product_image:demo/demo-silk-slip-skirt/2.jpg', '1a654c35-43c4-5609-bbb7-c188c141c817'),
  ('variant:DEMO-02-XS-IVO', '1ab75090-f258-5c3a-9822-3e621f0f84bb'),
  ('variant:DEMO-02-S-IVO', '67d745c3-a95e-519c-b32e-f616cc171586'),
  ('variant:DEMO-02-M-IVO', 'ff788088-e19e-50fc-a98f-7dc0bbb90dfc'),
  ('variant:DEMO-02-L-IVO', '355fe58d-10ed-5929-b035-0f40f576cfbe'),
  ('product:demo-merino-cardigan', 'b333a2a4-280f-532e-ab73-c52a0d019491'),
  ('product_image:demo/demo-merino-cardigan/1.jpg', '84cf9f3f-5356-5960-8674-459ce5e89f29'),
  ('product_image:demo/demo-merino-cardigan/2.jpg', 'a93940e3-f5e1-5095-a22e-55535f2cceab'),
  ('variant:DEMO-03-XS-IVO', '82c053f5-7861-5e30-a769-47bb7b7214f1'),
  ('variant:DEMO-03-S-IVO', '4b0a2ac9-b449-5be5-afd7-98afe166214d'),
  ('variant:DEMO-03-M-IVO', '5b898fa2-bb1c-5841-afaf-e73c9c3cfdd1'),
  ('variant:DEMO-03-L-IVO', '8f1bc1de-b25d-56ab-beb2-cc889388d09b'),
  ('product:demo-wool-coat', '69bd97fd-b28a-56b9-b0ac-c58d5dcd0002'),
  ('product_image:demo/demo-wool-coat/1.jpg', '7f869bc3-37c6-5b07-aa5f-41d21ec51bd3'),
  ('product_image:demo/demo-wool-coat/2.jpg', 'b43f8aa2-c5d6-5c04-9cf1-7cdef20da89b'),
  ('variant:DEMO-04-XS-IVO', 'c00421b3-36f3-55ea-9355-558a74a928cb'),
  ('variant:DEMO-04-S-IVO', '62680ce0-1d01-5cdc-8cee-8cfdbb9aff83'),
  ('variant:DEMO-04-M-IVO', 'e0bad807-acb4-54ca-867f-1d816466c48e'),
  ('variant:DEMO-04-L-IVO', '53b138ce-9f27-5b3e-ad35-e008faa22a17'),
  ('product:demo-cotton-shirt', '380f1dbe-53fa-59dc-bb4f-46e0929c44db'),
  ('product_image:demo/demo-cotton-shirt/1.jpg', 'c5b62353-78a0-57f2-98b7-b12e7165cf9a'),
  ('product_image:demo/demo-cotton-shirt/2.jpg', '4c022cc6-e0d3-56c9-97c6-0ad1a4c7a8b6'),
  ('variant:DEMO-05-XS-IVO', 'd27c482d-6533-5333-b050-318708a049c0'),
  ('variant:DEMO-05-S-IVO', '140802f2-5c46-5187-b6f3-7ce6bfbf0986'),
  ('variant:DEMO-05-M-IVO', 'b92ea659-7281-5791-a689-74bb803b806c'),
  ('variant:DEMO-05-L-IVO', 'bba6a969-2be6-59f7-a4a5-61366259ef90'),
  ('product:demo-leather-loafer', '06814a91-477d-510a-adfb-16a06e90fda1'),
  ('product_image:demo/demo-leather-loafer/1.jpg', '20f79fb7-6970-5c17-89a5-25fc4739c412'),
  ('product_image:demo/demo-leather-loafer/2.jpg', '69040e88-8e62-527c-b4ca-b59dd01e7faf'),
  ('variant:DEMO-06-37-ESP', '0d38f6b0-a492-52f0-ac03-0e03d5484c95'),
  ('variant:DEMO-06-38-ESP', 'e826ab9e-7cc6-5944-b3b9-8359d7dbdb9f'),
  ('variant:DEMO-06-39-ESP', 'b39e8ef0-ff1f-530c-896a-cbb4b24ee252'),
  ('variant:DEMO-06-40-ESP', '7bc5a961-afc7-550b-a909-3487758d6f53'),
  ('product:demo-suede-ankle-boot', '2f889d7f-2d51-5dba-a6cf-c945159bb7e7'),
  ('product_image:demo/demo-suede-ankle-boot/1.jpg', '39f56427-4c0c-53bf-a3e7-19c1bedded7a'),
  ('product_image:demo/demo-suede-ankle-boot/2.jpg', 'c1897d49-60c9-5121-acb5-e84fcbf0a20d'),
  ('variant:DEMO-07-37-ESP', '8fec6fed-b45a-58dc-bf1d-a7c29003d4ec'),
  ('variant:DEMO-07-38-ESP', '7ea8a9e9-0155-5fb4-b107-ac7829f21ace'),
  ('variant:DEMO-07-39-ESP', '143c3e95-74ad-5923-80d5-b9e71231e9d4'),
  ('variant:DEMO-07-40-ESP', '822bb5f5-753c-540a-8013-a91f0c2b893b'),
  ('product:demo-canvas-sneaker', 'a38379c1-04b5-54da-b1eb-4f63c7f63036'),
  ('product_image:demo/demo-canvas-sneaker/1.jpg', '16a20757-c7eb-5660-b18b-1ba7dd1230d8'),
  ('product_image:demo/demo-canvas-sneaker/2.jpg', 'b061fa61-afd0-5ed2-b4d1-3082f53aa22d'),
  ('variant:DEMO-08-37-ESP', '5b5f61e4-a2dc-52ce-91a9-2e79a4c71fe1'),
  ('variant:DEMO-08-38-ESP', '01a23149-4964-5e1f-b332-f90e4bbd54d0'),
  ('variant:DEMO-08-39-ESP', 'f95b925f-ea52-5db8-aa3a-d6620d619c46'),
  ('variant:DEMO-08-40-ESP', 'df39a256-3dab-500c-9edc-996f2304cd3b'),
  ('product:demo-mini-tote', '3d191545-8ce4-5133-8c1e-ce1769b59f1a'),
  ('product_image:demo/demo-mini-tote/1.jpg', 'efd4b731-8f64-51d7-af6f-a147cd65de7b'),
  ('product_image:demo/demo-mini-tote/2.jpg', '432b6422-0c6d-5be3-9b82-62b842e439a7'),
  ('variant:DEMO-09-OS-DUS', '67cb6164-76ad-5a9d-92d6-11ec824364a9'),
  ('variant:DEMO-09-OS-ESP', 'b6fb62ab-4925-546c-abb6-7b4338d9a8c4'),
  ('product:demo-silk-scarf', '0835e621-6719-54be-aa62-227b59d70433'),
  ('product_image:demo/demo-silk-scarf/1.jpg', '8250394b-7d88-5456-964c-91774858206d'),
  ('product_image:demo/demo-silk-scarf/2.jpg', 'fcea14b1-d025-5558-bec8-4200733b5b16'),
  ('variant:DEMO-10-OS-DUS', 'a5a1fe40-92d9-5265-aa66-9e13483b52c0'),
  ('variant:DEMO-10-OS-ESP', 'cc014598-c81b-5910-bbb5-f2680a21f7f7'),
  ('product:demo-leather-belt', 'f404a2a6-8a5a-5540-adcb-f232aeee8035'),
  ('product_image:demo/demo-leather-belt/1.jpg', '88547ef7-411c-5c45-9a32-1ee3704632e5'),
  ('product_image:demo/demo-leather-belt/2.jpg', '780e5069-23a2-5f34-af9b-f38724c61d8d'),
  ('variant:DEMO-11-OS-DUS', 'ee8093ed-d3ae-5fec-82eb-3f1b3c393475'),
  ('variant:DEMO-11-OS-ESP', 'ca5aea97-7f08-52c0-b266-5e3260b38539'),
  ('product:demo-card-holder', '8ef48af2-ec7a-59d3-a830-42197beb540b'),
  ('product_image:demo/demo-card-holder/1.jpg', 'c35c07e7-7e34-5ec0-9a12-b11191895984'),
  ('product_image:demo/demo-card-holder/2.jpg', 'f42bde82-f3e4-586c-a901-9299d803da34'),
  ('variant:DEMO-12-OS-DUS', '68c3ab2a-409d-5046-bbd2-cfeb301ae94b'),
  ('variant:DEMO-12-OS-ESP', '15464cc7-aeb7-50fe-9cb5-44c75039a05a'),
  ('tag:demo-editorial', '4f94266f-9c95-5f7a-8949-6c558d7c6f20'),
  ('tag:demo-styling', 'da614ba6-52a4-5545-b533-b649804bc553'),
  ('tag:demo-atelier', '17f1f640-2b6b-534e-a2f2-81b26e37b690'),
  ('article:demo-spring-edit', 'bee2899c-bbb2-5df6-af49-2484b0e6a11b'),
  ('article:demo-how-to-style-silk', 'ff86cb4b-3dcb-5ee0-934f-4c17eb0fae69'),
  ('article:demo-inside-the-atelier', '37cc0df5-b8c2-5c18-9bb3-8936baad953a'),
  ('article:demo-autumn-preview', '47a84655-7d0b-5375-84d5-43b61c6ef198');

do $$
declare
  p record;
  v record;
  v_pid uuid;
  v_vid uuid;
  v_cat uuid;
  v_aid uuid;
  i int := 0;
  v_sku text;
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
    insert into public.products (id, slug, category_id, brand, status, base_price_cents, currency, size_system,
                                 ikpu_code, package_code, vat_rate_bp, published_at)
    values ((select id from seed_ids where key = 'product:' || p.slug), p.slug, v_cat, 'DOOYOOSH', 'published', p.price, 'UZS', p.size_system::public.size_system,
            p.ikpu, null, 1200, now() - make_interval(days => 30 - i))
    returning id into v_pid;
    insert into public.product_translations (product_id, locale, name, description, materials, care, fit_notes)
    values (v_pid, 'en', p.name, p.descr || ' (Demo product.)', p.materials, 'See care label.', null);
    insert into public.product_images (id, product_id, storage_path, alt, sort_order, width, height)
    values ((select id from seed_ids where key = 'product_image:demo/' || p.slug || '/1.jpg'), v_pid, 'demo/' || p.slug || '/1.jpg', p.name || ' (demo image)', 0, 1200, 1500),
           ((select id from seed_ids where key = 'product_image:demo/' || p.slug || '/2.jpg'), v_pid, 'demo/' || p.slug || '/2.jpg', p.name || ' detail (demo image)', 1, 1200, 1500);

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
      v_sku := 'DEMO-' || lpad(i::text, 2, '0') || '-' || coalesce(v.size, 'OS') || '-' || upper(left(replace(v.colour, ' ', ''), 3));
      insert into public.product_variants (id, product_id, sku, size, colour, colour_hex, price_cents, is_active, weight_grams)
      values ((select id from seed_ids where key = 'variant:' || v_sku), v_pid, v_sku,
              v.size, v.colour, v.hex, null, true, case p.cat when 'footwear' then 900 when 'clothing' then 500 else 300 end)
      returning id into v_vid;
      -- one deliberately sold-out variant: Linen Wrap Dress / XS
      if not (p.slug = 'demo-linen-wrap-dress' and v.size = 'XS') then
        perform public.adjust_stock(v_vid, v.stock, 'restock', 'demo seed', null);
      end if;
    end loop;
  end loop;

  -- tags
  insert into public.tags (id, slug, name)
  select (select id from seed_ids where key = 'tag:' || t.slug), t.slug, t.name
    from (values ('demo-editorial', 'Editorial'), ('demo-styling', 'Styling'), ('demo-atelier', 'Atelier')) as t(slug, name);

  -- articles: 3 published + 1 draft
  for p in select * from (values
    ('demo-spring-edit', 'published', 'The Spring Edit', 'Light layers for the first warm days.', 'demo-editorial', 'demo-linen-wrap-dress', 10),
    ('demo-how-to-style-silk', 'published', 'How to Style Silk', 'Three ways to wear a silk slip skirt.', 'demo-styling', 'demo-silk-slip-skirt', 6),
    ('demo-inside-the-atelier', 'published', 'Inside the Atelier', 'Where our leather goods are finished by hand.', 'demo-atelier', 'demo-mini-tote', 2),
    ('demo-autumn-preview', 'draft', 'Autumn Preview (draft)', 'Not visible to the public.', 'demo-editorial', 'demo-wool-coat', 0)
  ) as t(slug, status, title, excerpt, tag, product, days_ago)
  loop
    insert into public.articles (id, slug, status, cover_image_path, author_name, published_at)
    values ((select id from seed_ids where key = 'article:' || p.slug), p.slug, p.status::public.article_status,
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
