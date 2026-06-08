-- =====================================================================
-- LogiCore WMS - 0016_p7_stocktake.sql
-- P7: 棚卸管理 (ロケーション棚卸・商品棚卸・差異管理・在庫補正)
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① inventory_counts: 棚卸ヘッダ
-- ---------------------------------------------------------------------
create table if not exists inventory_counts (
  id                 uuid primary key default gen_random_uuid(),
  count_no           text not null unique,
  count_type         text not null check (count_type in ('location','product')),
  status             text not null default 'counting' check (status in ('counting','completed')),
  target_location_id uuid references locations(id),
  target_product_id  uuid references products(id),
  started_by         uuid references auth.users(id),
  started_at         timestamptz not null default now(),
  completed_by       uuid references auth.users(id),
  completed_at       timestamptz,
  created_at         timestamptz not null default now()
);

alter table inventory_counts enable row level security;

create policy "ic_select" on inventory_counts
  for select to authenticated using (true);
create policy "ic_insert" on inventory_counts
  for insert to authenticated with check (fn_is_operator_or_admin());
create policy "ic_update" on inventory_counts
  for update to authenticated using (fn_is_operator_or_admin());

-- ---------------------------------------------------------------------
-- ② inventory_count_items: 棚卸明細
-- ---------------------------------------------------------------------
create table if not exists inventory_count_items (
  id                  uuid primary key default gen_random_uuid(),
  inventory_count_id  uuid not null references inventory_counts(id) on delete cascade,
  product_id          uuid not null references products(id),
  location_id         uuid not null references locations(id),
  system_qty          int not null default 0,
  count_qty           int,
  variance_qty        int,
  reason              text,
  created_at          timestamptz not null default now()
);

alter table inventory_count_items enable row level security;

create policy "ici_select" on inventory_count_items
  for select to authenticated using (true);
create policy "ici_insert" on inventory_count_items
  for insert to authenticated with check (fn_is_operator_or_admin());
create policy "ici_update" on inventory_count_items
  for update to authenticated using (fn_is_operator_or_admin());

-- ---------------------------------------------------------------------
-- ③ inventory_adjustments: 差異履歴
-- ---------------------------------------------------------------------
create table if not exists inventory_adjustments (
  id                  uuid primary key default gen_random_uuid(),
  inventory_count_id  uuid references inventory_counts(id),
  product_id          uuid not null references products(id),
  location_id         uuid not null references locations(id),
  before_qty          int not null,
  after_qty           int not null,
  variance_qty        int not null,
  reason              text,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now()
);

alter table inventory_adjustments enable row level security;

create policy "ia_select" on inventory_adjustments
  for select to authenticated using (true);
create policy "ia_insert" on inventory_adjustments
  for insert to authenticated with check (fn_is_operator_or_admin());

-- ---------------------------------------------------------------------
-- ④ fn_start_inventory_count: 棚卸開始
-- ---------------------------------------------------------------------
create or replace function fn_start_inventory_count(
  p_count_type         text,
  p_target_location_id uuid default null,
  p_target_product_id  uuid default null
)
returns jsonb as $$
declare
  v_count_no  text;
  v_count_id  uuid;
  v_seq       int;
  v_item_count int := 0;
begin
  if p_count_type = 'location' and p_target_location_id is null then
    raise exception 'ロケーションを指定してください';
  end if;
  if p_count_type = 'product' and p_target_product_id is null then
    raise exception '商品を指定してください';
  end if;

  insert into document_sequences (document_type, document_date, last_seq)
  values ('IC', current_date, 0)
  on conflict (document_type, document_date) do nothing;

  update document_sequences
  set last_seq = last_seq + 1
  where document_type = 'IC' and document_date = current_date
  returning last_seq into v_seq;

  v_count_no := 'IC' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');

  insert into inventory_counts (
    count_no, count_type, status,
    target_location_id, target_product_id,
    started_by, started_at
  ) values (
    v_count_no, p_count_type, 'counting',
    p_target_location_id, p_target_product_id,
    auth.uid(), now()
  ) returning id into v_count_id;

  if p_count_type = 'location' then
    insert into inventory_count_items (inventory_count_id, product_id, location_id, system_qty)
    select v_count_id, product_id, location_id, sum(qty)::int
    from inventory
    where location_id = p_target_location_id and qty > 0
    group by product_id, location_id;
  elsif p_count_type = 'product' then
    insert into inventory_count_items (inventory_count_id, product_id, location_id, system_qty)
    select v_count_id, product_id, location_id, sum(qty)::int
    from inventory
    where product_id = p_target_product_id and qty > 0
    group by product_id, location_id;
  end if;

  get diagnostics v_item_count = row_count;

  return jsonb_build_object(
    'id', v_count_id,
    'count_no', v_count_no,
    'item_count', v_item_count
  );
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- ⑤ fn_scan_inventory_count: JANスキャン棚卸 (count_qty 加算)
-- ---------------------------------------------------------------------
create or replace function fn_scan_inventory_count(
  p_count_id uuid,
  p_jan_code text,
  p_qty      int default 1
)
returns jsonb as $$
declare
  v_count   record;
  v_product record;
  v_item    record;
  v_new_qty int;
begin
  select * into v_count from inventory_counts where id = p_count_id;
  if v_count.id is null or v_count.status <> 'counting' then
    raise exception 'この棚卸は実施中ではありません';
  end if;

  select id, sku, name, jan_code into v_product
  from products where jan_code = p_jan_code and deleted_at is null limit 1;
  if v_product.id is null then
    raise exception '商品が見つかりません (JAN: %)', p_jan_code;
  end if;

  if v_count.count_type = 'location' then
    select * into v_item from inventory_count_items
    where inventory_count_id = p_count_id and product_id = v_product.id
    limit 1;
  else
    select * into v_item from inventory_count_items
    where inventory_count_id = p_count_id and product_id = v_product.id
    order by (count_qty is null) desc, created_at
    limit 1;
  end if;

  if v_item.id is null then
    if v_count.count_type = 'location' and v_count.target_location_id is not null then
      insert into inventory_count_items (
        inventory_count_id, product_id, location_id, system_qty, count_qty
      ) values (
        p_count_id, v_product.id, v_count.target_location_id, 0, p_qty
      ) returning * into v_item;
      v_new_qty := p_qty;
    else
      raise exception 'この商品は棚卸対象に含まれていません';
    end if;
  else
    v_new_qty := coalesce(v_item.count_qty, 0) + p_qty;
    update inventory_count_items set count_qty = v_new_qty where id = v_item.id;
  end if;

  return jsonb_build_object(
    'product_name', v_product.name,
    'product_sku',  v_product.sku,
    'system_qty',   v_item.system_qty,
    'count_qty',    v_new_qty,
    'scan_qty',     p_qty
  );
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- ⑥ fn_complete_inventory_count: 棚卸確定 (在庫補正 + 差異履歴)
-- ---------------------------------------------------------------------
create or replace function fn_complete_inventory_count(p_count_id uuid)
returns jsonb as $$
declare
  v_count    record;
  v_item     record;
  v_inv_id   uuid;
  v_cur_qty  int;
  v_delta    int;
  v_adjusted int := 0;
  v_total    int := 0;
begin
  select * into v_count from inventory_counts where id = p_count_id;
  if v_count.id is null or v_count.status <> 'counting' then
    raise exception '実施中の棚卸のみ確定できます';
  end if;

  for v_item in
    select * from inventory_count_items
    where inventory_count_id = p_count_id and count_qty is not null
  loop
    v_total := v_total + 1;
    v_delta := v_item.count_qty - v_item.system_qty;

    update inventory_count_items
    set variance_qty = v_delta
    where id = v_item.id;

    if v_delta <> 0 then
      select id, qty into v_inv_id, v_cur_qty from inventory
      where product_id = v_item.product_id and location_id = v_item.location_id
      order by qty desc limit 1;

      if v_inv_id is not null then
        update inventory
        set qty = greatest(0, qty + v_delta), updated_at = now()
        where id = v_inv_id;
      elsif v_delta > 0 then
        insert into inventory (product_id, location_id, lot_no, qty)
        values (v_item.product_id, v_item.location_id, '', v_item.count_qty);
      end if;

      insert into inventory_adjustments (
        inventory_count_id, product_id, location_id,
        before_qty, after_qty, variance_qty, reason, created_by
      ) values (
        p_count_id, v_item.product_id, v_item.location_id,
        v_item.system_qty, v_item.count_qty, v_delta,
        coalesce(v_item.reason, '棚卸差異'), auth.uid()
      );

      v_adjusted := v_adjusted + 1;
    end if;
  end loop;

  update inventory_counts
  set status = 'completed', completed_by = auth.uid(), completed_at = now()
  where id = p_count_id;

  return jsonb_build_object(
    'total_items', v_total,
    'adjusted_items', v_adjusted
  );
end;
$$ language plpgsql security definer;
