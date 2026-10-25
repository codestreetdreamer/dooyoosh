-- 0002_stock_order_functions (hand-written, drizzle-kit --custom). Owner: Backend & Database.
-- Stock and order operations (spec §4, §12.5, SCHEMA_DELTA A8; signatures fixed in src/contracts/inventory.ts).
-- All functions: SECURITY DEFINER, SET search_path = '', schema-qualified names,
-- EXECUTE revoked from public/anon/authenticated, granted to service_role only.
-- Errors: RAISE EXCEPTION '<CODE>' USING ERRCODE = 'P0001', DETAIL = <json>.
--   OUT_OF_STOCK / PRICE_CHANGED: DETAIL = json array of variant ids
--   VALIDATION_ERROR, NOT_FOUND, INVALID_STATE, AMOUNT_MISMATCH, INSUFFICIENT_STOCK: DETAIL = json object
-- Lock order everywhere: checkouts row -> stock_reservations rows -> product_variants rows (ORDER BY id).

-- ---------------------------------------------------------------------------
-- helpers (app_private, not callable by API roles)
-- ---------------------------------------------------------------------------
create or replace function app_private.raise_app_error(p_code text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_code using errcode = 'P0001', detail = coalesce(p_detail, '{}'::jsonb)::text;
end $$;

create or replace function app_private.generate_order_reference()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  b bytea;
  ref text;
  i int;
begin
  loop
    b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    ref := 'DY-' || to_char(now() at time zone 'UTC', 'YYYYMMDD') || '-';
    for i in 0..4 loop
      ref := ref || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.orders o where o.reference = ref);
  end loop;
  return ref;
end $$;

-- Releases all ACTIVE reservations of a checkout. Caller must hold the checkout row lock.
create or replace function app_private.release_reservations_locked(p_checkout_id uuid)
returns int language plpgsql set search_path = '' as $$
declare
  n int := 0;
  r record;
begin
  -- lock reservations, then variants in id order
  perform 1 from public.stock_reservations sr
    where sr.checkout_id = p_checkout_id and sr.status = 'active' order by sr.variant_id for update;
  perform 1 from public.product_variants v
    where v.id in (select sr.variant_id from public.stock_reservations sr
                   where sr.checkout_id = p_checkout_id and sr.status = 'active')
    order by v.id for update;
  for r in select sr.id, sr.variant_id, sr.quantity from public.stock_reservations sr
           where sr.checkout_id = p_checkout_id and sr.status = 'active' order by sr.variant_id
  loop
    update public.product_variants set stock_reserved = stock_reserved - r.quantity where id = r.variant_id;
    update public.stock_reservations set status = 'released', released_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- reserve_checkout(p_checkout_id, p_items, p_expires_at) returns void
--   p_items = [{"variant_id": uuid, "quantity": int}], quantity 1..10, no duplicates.
--   The checkouts row (with items snapshot + totals) must already exist (status open/awaiting_payment).
--   Re-checks against the DB: variant active, product published/not archived, currency, unit price
--   (snapshot unitPriceMinor must equal current price -> else PRICE_CHANGED), stock.
--   Idempotent: calling again with the same items while reservations are active is a no-op.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_checkout(p_checkout_id uuid, p_items jsonb, p_expires_at timestamptz)
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

-- ---------------------------------------------------------------------------
-- convert_checkout_to_order(p_checkout_id, p_order) returns jsonb
--   p_order = {"reference"?: "DY-YYYYMMDD-XXXXX" (generated if absent), "provider": payment_provider,
--              "provider_payment_id": text, "amount_minor": int, "currency": "UZS",
--              "paid_at"?: timestamptz, "raw"?: jsonb}
--   -> {"order_id","reference","status":"paid"|"stock_conflict"|"already_converted",
--       "order_status", "conflict_variant_ids":[...]}
--   QA-06: locks the checkout row and that checkout's reservations; converts ONLY if every reservation of
--   THIS checkout is still 'active'. Otherwise -> stock_conflict, no stock touched (never a CHECK violation).
--   Idempotent: a second call returns status 'already_converted' and changes nothing.
--   Raises AMOUNT_MISMATCH if amount/currency differ from checkouts.total_cents/currency (no order created).
--   p_conflict_mode: 'mark' (default) = create the order as stock_conflict (money was taken -> refund);
--                    'abort' = RAISE 'STOCK_CONFLICT' (DETAIL = json array of variant ids), everything rolls back
--                    (Payme PerformTransaction / Click Complete can then answer with an error and not take money).
-- ---------------------------------------------------------------------------
create or replace function public.convert_checkout_to_order(p_checkout_id uuid, p_order jsonb, p_conflict_mode text default 'mark')
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
  if p_conflict_mode is null or p_conflict_mode not in ('mark', 'abort') then
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
         coalesce(s."vatRateBp", p.vat_rate_bp, 1200), s."unitPriceMinor", s.quantity, s."unitPriceMinor" * s.quantity
    from jsonb_to_recordset(v_c.items) as s("variantId" uuid, sku text, "productName" text, size text, colour text,
                                            "unitPriceMinor" bigint, quantity int, "ikpuCode" text,
                                            "packageCode" text, "vatRateBp" int)
    left join public.product_variants v on v.id = s."variantId"
    left join public.products p on p.id = v.product_id;

  insert into public.payments (order_id, provider, provider_payment_id, amount_cents, currency, status, raw)
  values (v_order_id, v_provider, v_ppid, v_amount, v_currency, 'succeeded', p_order->'raw');

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
  elsif p_conflict_mode = 'abort' then
    raise exception 'STOCK_CONFLICT' using errcode = 'P0001', detail = to_jsonb(v_conflict)::text;
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

-- ---------------------------------------------------------------------------
-- release_checkout(p_checkout_id, p_reason) returns int (reservations released; 0 on repeat)
--   p_reason: expired | payment_failed | canceled  -> checkout status expired | failed | failed
--   (only if the checkout is still open/awaiting_payment; a completed checkout keeps its status)
-- ---------------------------------------------------------------------------
create or replace function public.release_checkout(p_checkout_id uuid, p_reason text)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.checkout_status;
  n int;
begin
  if p_reason is null or p_reason not in ('expired', 'payment_failed', 'canceled') then
    perform app_private.raise_app_error('VALIDATION_ERROR', jsonb_build_object('field', 'reason'));
  end if;
  select status into v_status from public.checkouts where id = p_checkout_id for update;
  if not found then
    perform app_private.raise_app_error('NOT_FOUND', jsonb_build_object('checkout_id', p_checkout_id));
  end if;
  n := app_private.release_reservations_locked(p_checkout_id);
  if v_status in ('open', 'awaiting_payment') then
    update public.checkouts
       set status = case when p_reason = 'expired' then 'expired'::public.checkout_status else 'failed'::public.checkout_status end
     where id = p_checkout_id;
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- release_expired_reservations(p_now, p_limit) returns int (reservations released)
--   Cron fallback sweep. Skips checkouts locked by a concurrent convert (SKIP LOCKED).
-- ---------------------------------------------------------------------------
create or replace function public.release_expired_reservations(p_now timestamptz default now(), p_limit int default 500)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_status public.checkout_status;
  total int := 0;
begin
  for v_id in
    select sr.checkout_id from public.stock_reservations sr
     where sr.status = 'active' and sr.expires_at <= p_now
     group by sr.checkout_id order by min(sr.expires_at)
     limit greatest(coalesce(p_limit, 500), 1)
  loop
    select c.status into v_status from public.checkouts c where c.id = v_id for update skip locked;
    continue when not found;
    -- re-check under lock (a convert may have finished meanwhile)
    continue when not exists (select 1 from public.stock_reservations sr
                               where sr.checkout_id = v_id and sr.status = 'active' and sr.expires_at <= p_now);
    total := total + app_private.release_reservations_locked(v_id);
    if v_status in ('open', 'awaiting_payment') then
      update public.checkouts set status = 'expired' where id = v_id;
    end if;
  end loop;
  return total;
end $$;

-- ---------------------------------------------------------------------------
-- adjust_stock(p_variant_id, p_delta, p_reason, p_note, p_actor_id) returns int (new stock_on_hand)
--   reason: restock | adjustment | return | damage | cancellation ('sale' only via convert).
--   Never lets stock_on_hand drop below stock_reserved -> INSUFFICIENT_STOCK.
-- ---------------------------------------------------------------------------
create or replace function public.adjust_stock(p_variant_id uuid, p_delta int, p_reason public.inventory_movement_reason,
                                               p_note text, p_actor_id uuid)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_new int;
begin
  if p_delta is null or p_delta = 0 or abs(p_delta) > 10000 then
    perform app_private.raise_app_error('VALIDATION_ERROR', jsonb_build_object('field', 'delta'));
  end if;
  if p_reason is null or p_reason = 'sale' then
    perform app_private.raise_app_error('VALIDATION_ERROR', jsonb_build_object('field', 'reason'));
  end if;
  update public.product_variants
     set stock_on_hand = stock_on_hand + p_delta
   where id = p_variant_id and stock_on_hand + p_delta >= stock_reserved
  returning stock_on_hand into v_new;
  if not found then
    if exists (select 1 from public.product_variants where id = p_variant_id) then
      perform app_private.raise_app_error('INSUFFICIENT_STOCK', jsonb_build_object('variant_id', p_variant_id));
    end if;
    perform app_private.raise_app_error('NOT_FOUND', jsonb_build_object('variant_id', p_variant_id));
  end if;
  insert into public.inventory_movements (variant_id, delta, reason, note, actor_id)
  values (p_variant_id, p_delta, p_reason, left(p_note, 500), p_actor_id);
  return v_new;
end $$;

-- ---------------------------------------------------------------------------
-- restock_order(p_order_id, p_reason, p_actor_id, p_note) returns int (units put back)
--   Return path, e.g. Payme CancelTransaction after PerformTransaction, or a cancelled order.
--   Puts back exactly what this order's 'sale' movements took, minus anything already restocked
--   for the order. Idempotent (second call returns 0). stock_conflict orders took nothing -> 0.
--   Does NOT change order status (that is src/server/orders/transitions.ts).
-- ---------------------------------------------------------------------------
create or replace function public.restock_order(p_order_id uuid, p_reason public.inventory_movement_reason default 'return',
                                                p_actor_id uuid default null, p_note text default null)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  total int := 0;
  r record;
begin
  if p_reason not in ('return', 'cancellation') then
    perform app_private.raise_app_error('VALIDATION_ERROR', jsonb_build_object('field', 'reason'));
  end if;
  perform 1 from public.orders where id = p_order_id for update;
  if not found then
    perform app_private.raise_app_error('NOT_FOUND', jsonb_build_object('order_id', p_order_id));
  end if;
  perform 1 from public.product_variants v
    where v.id in (select m.variant_id from public.inventory_movements m where m.order_id = p_order_id)
    order by v.id for update;
  for r in
    select m.variant_id, -sum(m.delta)::int as remaining
      from public.inventory_movements m
     where m.order_id = p_order_id and m.reason in ('sale', 'return', 'cancellation')
     group by m.variant_id
    having -sum(m.delta) > 0
     order by m.variant_id
  loop
    update public.product_variants set stock_on_hand = stock_on_hand + r.remaining where id = r.variant_id;
    insert into public.inventory_movements (variant_id, delta, reason, order_id, note, actor_id)
    values (r.variant_id, r.remaining, p_reason, p_order_id, left(p_note, 500), p_actor_id);
    total := total + r.remaining;
  end loop;
  if total > 0 then
    insert into public.order_events (order_id, type, payload, actor_id)
    values (p_order_id, 'stock_restocked', jsonb_build_object('units', total, 'reason', p_reason), p_actor_id);
  end if;
  return total;
end $$;

-- ---------------------------------------------------------------------------
-- Provider event idempotency
-- record_payment_event(...) returns boolean: true = first time seen (process it), false = duplicate.
-- mark_payment_event_processed(...): sets processed_at (and error, if any).
-- ---------------------------------------------------------------------------
create or replace function public.record_payment_event(p_provider public.payment_provider, p_event_id text,
                                                       p_type text, p_payload jsonb default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  if p_provider is null or coalesce(p_event_id, '') = '' or coalesce(p_type, '') = '' then
    perform app_private.raise_app_error('VALIDATION_ERROR', jsonb_build_object('field', 'event'));
  end if;
  insert into public.payment_events (provider, event_id, type, payload)
  values (p_provider, p_event_id, p_type, p_payload)
  on conflict (provider, event_id) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function public.mark_payment_event_processed(p_provider public.payment_provider, p_event_id text,
                                                               p_error text default null)
returns void
language sql security definer set search_path = '' as $$
  update public.payment_events
     set processed_at = now(), error = left(p_error, 2000)
   where provider = p_provider and event_id = p_event_id;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only (table owner `postgres`, used by DATABASE_URL, can always execute)
-- ---------------------------------------------------------------------------
revoke all on function public.reserve_checkout(uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.convert_checkout_to_order(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.release_checkout(uuid, text) from public, anon, authenticated;
revoke all on function public.release_expired_reservations(timestamptz, int) from public, anon, authenticated;
revoke all on function public.adjust_stock(uuid, int, public.inventory_movement_reason, text, uuid) from public, anon, authenticated;
revoke all on function public.restock_order(uuid, public.inventory_movement_reason, uuid, text) from public, anon, authenticated;
revoke all on function public.record_payment_event(public.payment_provider, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.mark_payment_event_processed(public.payment_provider, text, text) from public, anon, authenticated;
grant execute on function public.reserve_checkout(uuid, jsonb, timestamptz) to service_role;
grant execute on function public.convert_checkout_to_order(uuid, jsonb, text) to service_role;
grant execute on function public.release_checkout(uuid, text) to service_role;
grant execute on function public.release_expired_reservations(timestamptz, int) to service_role;
grant execute on function public.adjust_stock(uuid, int, public.inventory_movement_reason, text, uuid) to service_role;
grant execute on function public.restock_order(uuid, public.inventory_movement_reason, uuid, text) to service_role;
grant execute on function public.record_payment_event(public.payment_provider, text, text, jsonb) to service_role;
grant execute on function public.mark_payment_event_processed(public.payment_provider, text, text) to service_role;

revoke all on function app_private.raise_app_error(text, jsonb) from public, anon, authenticated;
revoke all on function app_private.generate_order_reference() from public, anon, authenticated;
revoke all on function app_private.release_reservations_locked(uuid) from public, anon, authenticated;
