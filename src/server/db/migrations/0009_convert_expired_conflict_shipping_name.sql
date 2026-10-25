-- 0009 (Backend & Database), LOCAL ONLY until QA green.
-- 1) Payments P1: convert_checkout_to_order treats a reservation with expires_at <= paid_at (p_order.paid_at, default
--    now()) as a stock conflict even if the sweeper has not marked it expired yet. Same 'record'/'abort' semantics,
--    same lock order, same signature (no app change: paid_at was already part of p_order).
-- 2) Architect 0009-c: checkouts.shipping_method_name snapshot (Payments writes it at checkout insert; NULL for old
--    rows), copied to orders.shipping_method_name by convert.
ALTER TABLE "checkouts" ADD COLUMN "shipping_method_name" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_method_name" text;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_shipping_method_name_len" CHECK ("checkouts"."shipping_method_name" IS NULL OR char_length("checkouts"."shipping_method_name") BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_method_name_len" CHECK ("orders"."shipping_method_name" IS NULL OR char_length("orders"."shipping_method_name") BETWEEN 1 AND 200);--> statement-breakpoint

create or replace function public.convert_checkout_to_order(p_checkout_id uuid, p_order jsonb, p_conflict_mode text default 'record')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.checkouts%rowtype;
  v_existing record;
  v_order_id uuid;
  v_ref text;
  v_provider public.payment_provider;
  v_ppid text;
  v_amount bigint;
  v_currency text;
  v_paid_at timestamptz;
  v_conflict uuid[];
  v_n_res int;
  r record;
begin
  if p_conflict_mode is null or p_conflict_mode not in ('record', 'abort') then
    perform app_private.raise_app_error('VALIDATION_ERROR', jsonb_build_object('field', 'conflict_mode'));
  end if;
  select * into v_c from public.checkouts where id = p_checkout_id for update;
  if not found then
    perform app_private.raise_app_error('NOT_FOUND', jsonb_build_object('checkout_id', p_checkout_id));
  end if;

  select o.id, o.reference, o.status into v_existing from public.orders o where o.checkout_id = p_checkout_id;
  if found then
    return jsonb_build_object('order_id', v_existing.id, 'reference', v_existing.reference,
      'status', 'already_converted', 'order_status', v_existing.status, 'conflict_variant_ids', '[]'::jsonb);
  end if;

  begin
    v_provider := (p_order->>'provider')::public.payment_provider;
    v_ppid := nullif(p_order->>'provider_payment_id', '');
    v_amount := (p_order->>'amount_minor')::bigint;
    v_currency := p_order->>'currency';
    v_paid_at := coalesce((p_order->>'paid_at')::timestamptz, now());
  exception when others then
    perform app_private.raise_app_error('VALIDATION_ERROR', jsonb_build_object('field', 'p_order'));
  end;
  if v_provider is null or v_ppid is null or v_amount is null or v_currency is null then
    perform app_private.raise_app_error('VALIDATION_ERROR', jsonb_build_object('field', 'p_order'));
  end if;
  if v_provider <> v_c.provider then
    perform app_private.raise_app_error('VALIDATION_ERROR', jsonb_build_object('field', 'provider'));
  end if;
  if v_amount <> v_c.total_cents or v_currency <> v_c.currency then
    perform app_private.raise_app_error('AMOUNT_MISMATCH', jsonb_build_object(
      'expected_minor', v_c.total_cents, 'expected_currency', v_c.currency, 'got_minor', v_amount, 'got_currency', v_currency));
  end if;
  if exists (select 1 from public.payments pm where pm.provider = v_provider and pm.provider_payment_id = v_ppid) then
    perform app_private.raise_app_error('INVALID_STATE', jsonb_build_object('reason', 'provider_payment_id_already_used'));
  end if;

  -- QA-06 + deadlock safety: lock THIS checkout's reservations and then ALL involved variants (id order) BEFORE
  -- inserting order_items (whose FK would otherwise take KEY SHARE locks that later need upgrading).
  perform 1 from public.stock_reservations sr where sr.checkout_id = p_checkout_id order by sr.variant_id for update;
  perform 1 from public.product_variants v
    where v.id in (select sr.variant_id from public.stock_reservations sr where sr.checkout_id = p_checkout_id
                   union select (s->>'variantId')::uuid from jsonb_array_elements(v_c.items) s)
    order by v.id for update;

  select count(*) into v_n_res from public.stock_reservations sr where sr.checkout_id = p_checkout_id;
  select coalesce(array_agg(x.vid order by x.vid), '{}') into v_conflict from (
    select sr.variant_id vid from public.stock_reservations sr
     where sr.checkout_id = p_checkout_id
       -- 0009 (Payments P1): an expired-but-not-yet-swept reservation is a conflict too (expires_at <= paid_at)
       and (sr.status <> 'active' or sr.expires_at <= v_paid_at)
    union
    -- snapshot lines with no reservation at all
    select (s->>'variantId')::uuid from jsonb_array_elements(v_c.items) s
     where not exists (select 1 from public.stock_reservations sr
                        where sr.checkout_id = p_checkout_id and sr.variant_id = (s->>'variantId')::uuid)
  ) x;

  -- 0006 'abort' (contract conflictMode): any non-active or expired (0009) reservation => write NOTHING, return status 'aborted'
  if p_conflict_mode = 'abort' and not (cardinality(v_conflict) = 0 and v_n_res > 0) then
    return jsonb_build_object('order_id', null, 'reference', null, 'status', 'aborted', 'order_status', null,
                              'conflict_variant_ids', to_jsonb(v_conflict));
  end if;

  v_ref := coalesce(nullif(p_order->>'reference', ''), app_private.generate_order_reference());
  if v_ref !~ '^DY-[0-9]{8}-[A-Z2-7]{5}$' then
    perform app_private.raise_app_error('VALIDATION_ERROR', jsonb_build_object('field', 'reference'));
  end if;

  insert into public.orders (reference, checkout_id, email, phone, locale, currency, subtotal_cents, shipping_cents,
                             tax_cents, discount_cents, total_cents, status, shipping_address, billing_address,
                             shipping_method_id, shipping_method_name, access_token_hash, placed_at)
  values (v_ref, v_c.id, v_c.email, v_c.phone, v_c.locale, v_c.currency, v_c.subtotal_cents, v_c.shipping_cents,
          v_c.tax_cents, v_c.discount_cents, v_c.total_cents, 'pending_payment', v_c.shipping_address, v_c.billing_address,
          v_c.shipping_method_id, v_c.shipping_method_name, v_c.access_token_hash, v_c.created_at)
  returning id into v_order_id;

  -- order_items: snapshot from checkout + fiscal fields (IKPU, package code, VAT) from products at convert time
  insert into public.order_items (order_id, variant_id, sku, product_name, size, colour, ikpu_code, package_code,
                                  vat_rate_bp, unit_price_cents, quantity, line_total_cents)
  select v_order_id, s."variantId", s.sku, s."productName", s.size, s.colour,
         coalesce(s."ikpuCode", p.ikpu_code), coalesce(s."packageCode", p.package_code),
         coalesce(s."vatRateBp", p.vat_rate_bp), s."unitPriceMinor", s.quantity, s."unitPriceMinor" * s.quantity
    from jsonb_to_recordset(v_c.items) as s("variantId" uuid, sku text, "productName" text, size text, colour text,
                                            "unitPriceMinor" bigint, quantity int, "ikpuCode" text,
                                            "packageCode" text, "vatRateBp" int)
    left join public.product_variants v on v.id = s."variantId"
    left join public.products p on p.id = v.product_id;

  insert into public.payments (order_id, provider, provider_payment_id, amount_cents, currency, status, raw)
  values (v_order_id, v_provider, v_ppid, v_amount, v_currency, 'succeeded', p_order->'raw');



  if cardinality(v_conflict) = 0 and v_n_res > 0 then
    for r in select sr.id, sr.variant_id, sr.quantity from public.stock_reservations sr
              where sr.checkout_id = p_checkout_id and sr.status = 'active' order by sr.variant_id
    loop
      update public.product_variants
         set stock_on_hand = stock_on_hand - r.quantity, stock_reserved = stock_reserved - r.quantity
       where id = r.variant_id;
      insert into public.inventory_movements (variant_id, delta, reason, order_id, note)
      values (r.variant_id, -r.quantity, 'sale', v_order_id, 'checkout ' || p_checkout_id::text);
      update public.stock_reservations set status = 'converted', converted_at = now() where id = r.id;
    end loop;
    update public.orders set status = 'paid', paid_at = v_paid_at where id = v_order_id;
    insert into public.order_events (order_id, type, from_status, to_status, payload)
    values (v_order_id, 'payment_received', 'pending_payment', 'paid',
            jsonb_build_object('provider', v_provider, 'provider_payment_id', v_ppid, 'amount_minor', v_amount));
  else
    -- late payment: free anything still held (normally nothing) and flag for automatic refund
    perform app_private.release_reservations_locked(p_checkout_id);
    update public.orders set status = 'stock_conflict', paid_at = v_paid_at where id = v_order_id;
    insert into public.order_events (order_id, type, from_status, to_status, payload)
    values (v_order_id, 'stock_conflict', 'pending_payment', 'stock_conflict',
            jsonb_build_object('variantIds', to_jsonb(v_conflict), 'provider', v_provider, 'provider_payment_id', v_ppid));
  end if;

  update public.checkouts set status = 'completed' where id = p_checkout_id;

  return jsonb_build_object('order_id', v_order_id, 'reference', v_ref,
    'status', case when cardinality(v_conflict) = 0 and v_n_res > 0 then 'paid' else 'stock_conflict' end,
    'order_status', case when cardinality(v_conflict) = 0 and v_n_res > 0 then 'paid' else 'stock_conflict' end,
    'conflict_variant_ids', to_jsonb(v_conflict));
end $$;

revoke all on function public.convert_checkout_to_order(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.convert_checkout_to_order(uuid, jsonb, text) to service_role;
