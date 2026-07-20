-- =====================================================================
-- SUPEREX LogiStation - 0020_outbound_allocation.sql
-- 出荷引当: 出庫明細に対して在庫(ロット/ロケーション)を引き当てる
--   ・fn_outbound_allocate      : 引当確定 (pending → picking, locked_qty加算)
--   ・fn_outbound_unallocate    : 引当解除 (picking → pending, locked_qty返却)
--   ・fn_outbound_ship_allocated: 引当分を出荷計上 (在庫控除・movement記録)
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① 引当テーブル
-- ---------------------------------------------------------------------
create table if not exists outbound_allocations (
  id                uuid primary key default gen_random_uuid(),
  outbound_item_id  uuid not null references outbound_items(id) on delete cascade,
  inventory_id      uuid not null references inventory(id),
  qty               int not null check (qty > 0),
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now()
);

create index if not exists idx_ob_alloc_item on outbound_allocations(outbound_item_id);

alter table outbound_allocations enable row level security;

create policy "ob_alloc_select" on outbound_allocations
  for select to authenticated using (true);
create policy "ob_alloc_op_write" on outbound_allocations
  for all to authenticated
  using (fn_is_operator_or_admin()) with check (fn_is_operator_or_admin());

-- ---------------------------------------------------------------------
-- ② fn_outbound_allocate: 引当確定
--    p_allocations: [{item_id, inventory_id, qty}, ...]
-- ---------------------------------------------------------------------
create or replace function fn_outbound_allocate(
  p_order_id uuid,
  p_allocations jsonb default '[]'::jsonb
)
returns void as $$
declare
  v_order outbound_orders%rowtype;
  v_a jsonb;
  v_item outbound_items%rowtype;
  v_inv inventory%rowtype;
  v_qty int;
begin
  if not fn_is_operator_or_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_order from outbound_orders where id = p_order_id for update;
  if not found then raise exception '出庫伝票が見つかりません'; end if;
  if v_order.status <> 'pending' then
    raise exception '指示待ちの出庫のみ引当できます';
  end if;

  for v_a in select * from jsonb_array_elements(p_allocations)
  loop
    v_qty := (v_a->>'qty')::int;
    if v_qty is null or v_qty <= 0 then continue; end if;

    select * into v_item from outbound_items
    where id = (v_a->>'item_id')::uuid and order_id = p_order_id;
    if not found then raise exception '出庫明細が不正です'; end if;

    select * into v_inv from inventory
    where id = (v_a->>'inventory_id')::uuid for update;
    if not found then raise exception '在庫行が見つかりません'; end if;
    if v_inv.product_id <> v_item.product_id then
      raise exception '商品が一致しません';
    end if;
    if (v_inv.qty - v_inv.locked_qty) < v_qty then
      raise exception '利用可能数が不足しています（他伝票で引当済みの可能性）';
    end if;

    update inventory
    set locked_qty = locked_qty + v_qty, updated_at = now()
    where id = v_inv.id;

    insert into outbound_allocations (outbound_item_id, inventory_id, qty, created_by)
    values (v_item.id, v_inv.id, v_qty, auth.uid());
  end loop;

  if not exists (
    select 1 from outbound_allocations oa
    join outbound_items oi on oi.id = oa.outbound_item_id
    where oi.order_id = p_order_id
  ) then
    raise exception '引当行がありません';
  end if;

  update outbound_orders set status = 'picking', updated_at = now()
  where id = p_order_id;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- ③ fn_outbound_unallocate: 引当解除
-- ---------------------------------------------------------------------
create or replace function fn_outbound_unallocate(p_order_id uuid)
returns void as $$
declare
  v_order outbound_orders%rowtype;
  v_rec record;
begin
  if not fn_is_operator_or_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_order from outbound_orders where id = p_order_id for update;
  if not found then raise exception '出庫伝票が見つかりません'; end if;
  if v_order.status <> 'picking' then
    raise exception '引当済みの出庫のみ解除できます';
  end if;

  for v_rec in
    select oa.* from outbound_allocations oa
    join outbound_items oi on oi.id = oa.outbound_item_id
    where oi.order_id = p_order_id
  loop
    update inventory
    set locked_qty = greatest(0, locked_qty - v_rec.qty), updated_at = now()
    where id = v_rec.inventory_id;
    delete from outbound_allocations where id = v_rec.id;
  end loop;

  update outbound_orders set status = 'pending', updated_at = now()
  where id = p_order_id;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- ④ fn_outbound_ship_allocated: 引当分を出荷計上
--    各引当行の在庫を控除(locked_qtyも返却)し movement を記録。
--    明細の代表ロケ/ロットは先頭引当行のものを記録
--    (複数行の内訳は inventory_movements に残る)。
-- ---------------------------------------------------------------------
create or replace function fn_outbound_ship_allocated(p_order_id uuid)
returns jsonb as $$
declare
  v_order outbound_orders%rowtype;
  v_item outbound_items%rowtype;
  v_rec record;
  v_inv inventory%rowtype;
  v_total int;
  v_first_loc uuid;
  v_first_lot text;
  v_first_exp date;
  v_shipped_items int := 0;
begin
  if not fn_is_operator_or_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_order from outbound_orders where id = p_order_id for update;
  if not found then raise exception '出庫伝票が見つかりません'; end if;
  if v_order.status <> 'picking' then
    raise exception '引当済みの出庫のみ出荷計上できます';
  end if;

  for v_item in
    select * from outbound_items where order_id = p_order_id and status <> 'shipped'
  loop
    v_total := 0;
    v_first_loc := null;
    v_first_lot := null;
    v_first_exp := null;

    for v_rec in
      select * from outbound_allocations
      where outbound_item_id = v_item.id
      order by created_at
    loop
      select * into v_inv from inventory where id = v_rec.inventory_id for update;
      if not found or v_inv.qty < v_rec.qty then
        raise exception '在庫数量が不足しています（棚卸等で変動した可能性）';
      end if;

      update inventory
      set qty = qty - v_rec.qty,
          locked_qty = greatest(0, locked_qty - v_rec.qty),
          updated_at = now()
      where id = v_inv.id;

      insert into inventory_movements(product_id, location_id, lot_no, expiry,
                                      qty_delta, type, ref_type, ref_id, created_by)
      values (v_item.product_id, v_inv.location_id, v_inv.lot_no, v_inv.expiry,
              -v_rec.qty, 'outbound', 'outbound_items', v_item.id, auth.uid());

      if v_first_loc is null then
        v_first_loc := v_inv.location_id;
        v_first_lot := v_inv.lot_no;
        v_first_exp := v_inv.expiry;
      end if;
      v_total := v_total + v_rec.qty;

      delete from outbound_allocations where id = v_rec.id;
    end loop;

    if v_total > 0 then
      update outbound_items
      set picked_qty = v_total,
          from_location_id = v_first_loc,
          lot_no = coalesce(v_first_lot, ''),
          expiry = v_first_exp,
          status = 'shipped'
      where id = v_item.id;
      v_shipped_items := v_shipped_items + 1;
    end if;
  end loop;

  if not exists (
    select 1 from outbound_items where order_id = p_order_id and status <> 'shipped'
  ) then
    update outbound_orders set status = 'shipped', updated_at = now()
    where id = p_order_id;
  end if;

  return jsonb_build_object('shipped_items', v_shipped_items);
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- ⑤ 実行権限
-- ---------------------------------------------------------------------
revoke execute on function fn_outbound_allocate(uuid, jsonb) from public;
revoke execute on function fn_outbound_unallocate(uuid) from public;
revoke execute on function fn_outbound_ship_allocated(uuid) from public;

grant execute on function fn_outbound_allocate(uuid, jsonb) to authenticated;
grant execute on function fn_outbound_unallocate(uuid) to authenticated;
grant execute on function fn_outbound_ship_allocated(uuid) to authenticated;
