-- 0006 (Backend & Database), LOCAL ONLY until QA green. Function changes (0002 is frozen on staging):
-- 1) convert_checkout_to_order: conflict modes renamed to the contract's 'record' (default) | 'abort'; 'abort' now writes
--    nothing and RETURNS {status:'aborted', conflict_variant_ids} (no exception, caller's transaction stays usable);
--    order_items.vat_rate_bp = snapshot vatRateBp else products.vat_rate_bp (no hardcoded 1200 fallback).
-- 2) reserve_checkout gains p_payload_hash text default null: IDEMPOTENCY_CONFLICT when the checkout's stored
--    idempotency_payload_hash differs (same idempotencyKey, different payload => API 409).
-- 3) checkout_id_for_idempotency_key(key, payload_hash): lookup helper for the race-safe createCheckout flow.

drop function if exists public.convert_checkout_to_order(uuid, jsonb, text);
drop function if exists public.reserve_checkout(uuid, jsonb, timestamptz);

create function public.reserve_checkout(p_checkout_id uuid, p_items jsonb, p_expires_at timestamptz,
                                        p_payload_hash text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.checkouts%rowtype;
  v_lines jsonb;
  v_oos uuid[] := '{}';
  v_price uuid[] := '{}';
  v_subtotal bigint := 0;
  v_updated int;
  r record;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 50 then
    perform app_private.raise_app_error('VALIDATION_ERROR', jsonb_build_object('field', 'items'));
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '2 hours' then
    perform app_private.raise_app_error('VALIDATION_ERROR', jsonb_build_object('field', 'expires_at'));
  end if;

  -- QA-07: strict line validation (qty integer 1..10, uuid, no duplicates)
  begin
    select jsonb_agg(jsonb_build_object('variant_id', (e->>'variant_id')::uuid, 'quantity', (e->>'quantity')::int))
      into v_lines
      from jsonb_array_elements(p_items) e
     where jsonb_typeof(e->'quantity') = 'number'
       and (e->>'quantity')::numeric = trunc((e->>'quantity')::numeric)
       and (e->>'quantity')::numeric between 1 and 10
       and e->>'variant_id' is not null;
  exception when invalid_text_representation or numeric_value_out_of_range then
    perform app_private.raise_app_error('VALIDATION_ERROR', jsonb_build_object('field', 'items'));
  end;
  if v_lines is null or jsonb_array_length(v_lines) <> jsonb_array_length(p_items)
     or (select count(distinct x->>'variant_id') from jsonb_array_elements(v_lines) x) <> jsonb_array_length(v_lines) then
    perform app_private.raise_app_error('VALIDATION_ERROR', jsonb_build_object('field', 'items'));
  end if;

  select * into v_c from public.checkouts where id = p_checkout_id for update;
  if not found then
    perform app_private.raise_app_error('NOT_FOUND', jsonb_build_object('checkout_id', p_checkout_id));
  end if;
  -- 0006: same idempotencyKey with a different request payload => IDEMPOTENCY_CONFLICT (API 409)
  if p_payload_hash is not null and v_c.idempotency_payload_hash is not null
     and v_c.idempotency_payload_hash <> p_payload_hash then
    perform app_private.raise_app_error('IDEMPOTENCY_CONFLICT', jsonb_build_object('checkout_id', p_checkout_id));
  end if;
  if v_c.status not in ('open', 'awaiting_payment') then
    perform app_private.raise_app_error('INVALID_STATE', jsonb_build_object('checkout_status', v_c.status));
  end if;

  -- idempotent retry
  if exists (select 1 from public.stock_reservations where checkout_id = p_checkout_id) then
    if not exists (
         select 1 from public.stock_reservations sr
          full join (select (x->>'variant_id')::uuid variant_id, (x->>'quantity')::int quantity
                       from jsonb_array_elements(v_lines) x) l on l.variant_id = sr.variant_id
                                                             and sr.checkout_id = p_checkout_id
         where (sr.checkout_id = p_checkout_id or sr.checkout_id is null)
           and (sr.id is null or l.variant_id is null or sr.quantity <> l.quantity or sr.status <> 'active'))
    then
      return;
    end if;
    perform app_private.raise_app_error('INVALID_STATE', jsonb_build_object('reason', 'already_reserved'));
  end if;

  -- lock variants in id order, then evaluate every line (report ALL failing variant ids)
  perform 1 from public.product_variants v
    where v.id in (select (x->>'variant_id')::uuid from jsonb_array_elements(v_lines) x)
    order by v.id for update;
  for r in
    select l.variant_id, l.quantity, v.id as vid, v.is_active, v.stock_on_hand, v.stock_reserved,
           coalesce(v.price_cents, p.base_price_cents) as price, p.status as pstatus, p.archived_at,
           p.published_at, p.currency as pcurrency,
           (select (s->>'unitPriceMinor')::bigint from jsonb_array_elements(v_c.items) s
             where s->>'variantId' = l.variant_id::text limit 1) as snap_price,
           (select (s->>'quantity')::int from jsonb_array_elements(v_c.items) s
             where s->>'variantId' = l.variant_id::text limit 1) as snap_qty
      from (select (x->>'variant_id')::uuid variant_id, (x->>'quantity')::int quantity
              from jsonb_array_elements(v_lines) x) l
      left join public.product_variants v on v.id = l.variant_id
      left join public.products p on p.id = v.product_id
     order by l.variant_id
  loop
    if r.vid is null or not r.is_active or r.pstatus <> 'published' or r.archived_at is not null
       or r.published_at is null or r.published_at > now()
       or r.stock_on_hand - r.stock_reserved < r.quantity then
      v_oos := v_oos || r.variant_id;
    elsif r.pcurrency <> v_c.currency then
      perform app_private.raise_app_error('VALIDATION_ERROR', jsonb_build_object('field', 'currency', 'variant_id', r.variant_id));
    elsif r.snap_qty is distinct from r.quantity then
      perform app_private.raise_app_error('VALIDATION_ERROR', jsonb_build_object('field', 'items_snapshot', 'variant_id', r.variant_id));
    elsif r.snap_price is distinct from r.price then
      v_price := v_price || r.variant_id;
    else
      v_subtotal := v_subtotal + r.price * r.quantity;
    end if;
  end loop;

  if cardinality(v_oos) > 0 then
    raise exception 'OUT_OF_STOCK' using errcode = 'P0001', detail = to_jsonb(v_oos)::text;
  end if;
  if cardinality(v_price) > 0 then
    raise exception 'PRICE_CHANGED' using errcode = 'P0001', detail = to_jsonb(v_price)::text;
  end if;
  if v_subtotal <> v_c.subtotal_cents
     or jsonb_array_length(v_c.items) <> jsonb_array_length(v_lines) then
    perform app_private.raise_app_error('VALIDATION_ERROR',
      jsonb_build_object('field', 'subtotal', 'expected', v_subtotal, 'got', v_c.subtotal_cents));
  end if;

  -- spec §4 conditional UPDATE (belt and braces: rows are already locked)
  for r in select (x->>'variant_id')::uuid variant_id, (x->>'quantity')::int quantity
             from jsonb_array_elements(v_lines) x order by 1
  loop
    update public.product_variants
       set stock_reserved = stock_reserved + r.quantity
     where id = r.variant_id and is_active and stock_on_hand - stock_reserved >= r.quantity;
    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      raise exception 'OUT_OF_STOCK' using errcode = 'P0001', detail = to_jsonb(array[r.variant_id])::text;
    end if;
    insert into public.stock_reservations (variant_id, checkout_id, quantity, expires_at, status)
    values (r.variant_id, p_checkout_id, r.quantity, p_expires_at, 'active');
  end loop;

  update public.checkouts set reserved_until = p_expires_at where id = p_checkout_id;
end $$;

create function public.convert_checkout_to_order(p_checkout_id uuid, p_order jsonb, p_conflict_mode text default 'record')
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
     where sr.checkout_id = p_checkout_id and sr.status <> 'active'
    union
    -- snapshot lines with no reservation at all
    select (s->>'variantId')::uuid from jsonb_array_elements(v_c.items) s
     where not exists (select 1 from public.stock_reservations sr
                        where sr.checkout_id = p_checkout_id and sr.variant_id = (s->>'variantId')::uuid)
  ) x;

  -- 0006 'abort' (contract conflictMode): any non-active reservation => write NOTHING, return status 'aborted'
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
                             shipping_method_id, access_token_hash, placed_at)
  values (v_ref, v_c.id, v_c.email, v_c.phone, v_c.locale, v_c.currency, v_c.subtotal_cents, v_c.shipping_cents,
          v_c.tax_cents, v_c.discount_cents, v_c.total_cents, 'pending_payment', v_c.shipping_address, v_c.billing_address,
          v_c.shipping_method_id, v_c.access_token_hash, v_c.created_at)
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

-- Race-safe createCheckout: INSERT ... ON CONFLICT (idempotency_key) DO NOTHING; then call this.
-- Returns the checkout id for the key (null if none); IDEMPOTENCY_CONFLICT if the stored payload hash differs.
create function public.checkout_id_for_idempotency_key(p_key uuid, p_payload_hash text)
returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
  v_hash text;
begin
  select c.id, c.idempotency_payload_hash into v_id, v_hash from public.checkouts c where c.idempotency_key = p_key;
  if v_id is not null and v_hash is distinct from p_payload_hash then
    perform app_private.raise_app_error('IDEMPOTENCY_CONFLICT', jsonb_build_object('checkout_id', v_id));
  end if;
  return v_id;
end $$;

revoke all on function public.reserve_checkout(uuid, jsonb, timestamptz, text) from public, anon, authenticated;
revoke all on function public.convert_checkout_to_order(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.checkout_id_for_idempotency_key(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_checkout(uuid, jsonb, timestamptz, text) to service_role;
grant execute on function public.convert_checkout_to_order(uuid, jsonb, text) to service_role;
grant execute on function public.checkout_id_for_idempotency_key(uuid, text) to service_role;
