-- =====================================================================
-- SUPEREX LogiStation - 0021_allocation_deducts_stock.sql
-- 出荷引当の方式変更:
--   ・引当確定と同時に在庫(inventory.qty)を直接控除する
--     (旧方式の locked_qty 予約は廃止)
--   ・引当解除(fn_outbound_unallocate)は廃止
--   ・出荷確定はステータス更新のみ(在庫は引当時に控除済み)
--   ・部分引当した伝票(picking)の残り明細への追加引当を許可
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① fn_outbound_allocate: 引当確定 = 在庫控除
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
  v_item_ids uuid[] := '{}';
begin
  if not fn_is_operator_or_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_order from outbound_orders where id = p_order_id for update;
  if not found then raise exception '出庫伝票が見つかりません'; end if;
  if v_order.status not in ('pending', 'picking') then
    raise exception '指示待ちまたは引当済み(残明細あり)の出庫のみ引当できます';
  end if;

  for v_a in select * from jsonb_array_elements(p_allocations)
  loop
    v_qty := (v_a->>'qty')::int;
    if v_qty is null or v_qty <= 0 then continue; end if;

    select * into v_item from outbound_items
    where id = (v_a->>'item_id')::uuid and order_id = p_order_id
    for update;
    if not found then raise exception '出庫明細が不正です'; end if;
    -- この呼び出し内で処理中の明細は複数在庫行への分割を許可
    if v_item.status <> 'pending' and not (v_item.id = any(v_item_ids)) then
      raise exception '既に引当済みの明細です';
    end if;

    select * into v_inv from inventory
    where id = (v_a->>'inventory_id')::uuid for update;
    if not found then raise exception '在庫行が見つかりません'; end if;
    if v_inv.product_id <> v_item.product_id then
      raise exception '商品が一致しません';
    end if;
    if (v_inv.qty - v_inv.locked_qty) < v_qty then
      raise exception '在庫数量が不足しています';
    end if;

    -- 在庫を直接控除し、移動履歴を記録
    update inventory
    set qty = qty - v_qty, updated_at = now()
    where id = v_inv.id;

    insert into inventory_movements(product_id, location_id, lot_no, expiry,
                                    qty_delta, type, ref_type, ref_id, created_by)
    values (v_item.product_id, v_inv.location_id, v_inv.lot_no, v_inv.expiry,
            -v_qty, 'outbound', 'outbound_items', v_item.id, auth.uid());

    -- 引当記録(ピッキングリスト・出荷履歴用)
    insert into outbound_allocations (outbound_item_id, inventory_id, qty, created_by)
    values (v_item.id, v_inv.id, v_qty, auth.uid());

    -- 明細を引当済み(picked)に。代表ロケ/ロットは先頭引当行のもの
    update outbound_items
    set picked_qty = picked_qty + v_qty,
        status = 'picked',
        from_location_id = coalesce(from_location_id, v_inv.location_id),
        lot_no = case when picked_qty = 0 then v_inv.lot_no else lot_no end,
        expiry = case when picked_qty = 0 then v_inv.expiry else expiry end
    where id = v_item.id;

    if not (v_item.id = any(v_item_ids)) then
      v_item_ids := array_append(v_item_ids, v_item.id);
    end if;
  end loop;

  if array_length(v_item_ids, 1) is null then
    raise exception '引当行がありません';
  end if;

  update outbound_orders set status = 'picking', updated_at = now()
  where id = p_order_id;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- ② fn_outbound_ship_allocated: 出荷確定 (ステータス更新のみ)
-- ---------------------------------------------------------------------
create or replace function fn_outbound_ship_allocated(p_order_id uuid)
returns jsonb as $$
declare
  v_order outbound_orders%rowtype;
  v_shipped int := 0;
begin
  if not fn_is_operator_or_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_order from outbound_orders where id = p_order_id for update;
  if not found then raise exception '出庫伝票が見つかりません'; end if;
  if v_order.status <> 'picking' then
    raise exception '引当済みの出庫のみ出荷確定できます';
  end if;

  update outbound_items set status = 'shipped'
  where order_id = p_order_id and status = 'picked';
  get diagnostics v_shipped = row_count;

  if v_shipped = 0 then
    raise exception '引当済みの明細がありません';
  end if;

  if not exists (
    select 1 from outbound_items where order_id = p_order_id and status <> 'shipped'
  ) then
    update outbound_orders set status = 'shipped', updated_at = now()
    where id = p_order_id;
  end if;

  return jsonb_build_object('shipped_items', v_shipped);
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- ③ 引当解除は廃止
-- ---------------------------------------------------------------------
drop function if exists fn_outbound_unallocate(uuid);

-- ---------------------------------------------------------------------
-- ④ 実行権限
-- ---------------------------------------------------------------------
revoke execute on function fn_outbound_allocate(uuid, jsonb) from public;
revoke execute on function fn_outbound_ship_allocated(uuid) from public;
grant execute on function fn_outbound_allocate(uuid, jsonb) to authenticated;
grant execute on function fn_outbound_ship_allocated(uuid) to authenticated;
