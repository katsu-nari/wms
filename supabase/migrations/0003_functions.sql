-- =====================================================================
-- LogiCore WMS - 0003_functions.sql
-- RPC 関数:
--   認証系 (fn_check_login_allowed / fn_record_login_attempt)
--   在庫操作系 (inbound putaway / outbound pick / inventory move)
--   棚卸系 (snapshot / confirm)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 認証 : ログイン前にロック状態を確認する
-- anon からも呼び出せるよう security definer
-- ---------------------------------------------------------------------
create or replace function fn_check_login_allowed(emp text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  p profiles%rowtype;
  recent_fail int;
begin
  select * into p from profiles where employee_number = emp;
  if not found then
    -- ユーザーが存在しなくても攻撃者に情報を与えないので OK を返す
    return jsonb_build_object('ok', true);
  end if;
  if p.is_locked then
    return jsonb_build_object('ok', false, 'code','locked',
      'message','アカウントがロックされています。管理者に連絡してください');
  end if;
  if p.locked_until is not null and p.locked_until > now() then
    return jsonb_build_object('ok', false, 'code','cooldown',
      'message', format('一時ロック中です。%s秒後に再試行してください',
                        extract(epoch from (p.locked_until - now()))::int));
  end if;
  return jsonb_build_object('ok', true);
end; $$;

grant execute on function fn_check_login_allowed(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 認証 : ログイン試行を記録し、必要ならロック設定
-- ---------------------------------------------------------------------
create or replace function fn_record_login_attempt(emp text, ok boolean)
returns void language plpgsql security definer
set search_path = public as $$
declare
  fail_15 int;
  fail_24 int;
begin
  insert into login_attempts(employee_number, success)
    values (emp, ok);

  if not exists (select 1 from profiles where employee_number = emp) then
    return;
  end if;

  if ok then
    update profiles
       set failed_count = 0, locked_until = null, last_login_at = now()
     where employee_number = emp;
    return;
  end if;

  select count(*) into fail_15 from login_attempts
    where employee_number = emp and success = false
      and attempted_at > now() - interval '15 minutes';

  select count(*) into fail_24 from login_attempts
    where employee_number = emp and success = false
      and attempted_at > now() - interval '24 hours';

  update profiles
     set failed_count = fail_15,
         locked_until = case when fail_15 >= 5 then now() + interval '15 minutes' else locked_until end,
         is_locked    = case when fail_24 >= 20 then true else is_locked end
   where employee_number = emp;
end; $$;

grant execute on function fn_record_login_attempt(text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 内部ヘルパ : inventory をロット・期限を考慮して upsert
-- ---------------------------------------------------------------------
create or replace function fn_inventory_upsert(
  p_product uuid, p_location uuid, p_lot text, p_expiry date, p_delta int
) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  select id into v_id from inventory
   where product_id = p_product
     and location_id = p_location
     and lot_no = coalesce(p_lot,'')
     and coalesce(expiry,'9999-12-31'::date) = coalesce(p_expiry,'9999-12-31'::date)
   for update;

  if found then
    update inventory set qty = qty + p_delta, updated_at = now() where id = v_id;
    if (select qty from inventory where id = v_id) < 0 then
      raise exception 'inventory would go negative (id=%)', v_id;
    end if;
  else
    if p_delta < 0 then
      raise exception 'no inventory row to decrement';
    end if;
    insert into inventory(product_id, location_id, lot_no, expiry, qty)
    values (p_product, p_location, coalesce(p_lot,''), p_expiry, p_delta)
    returning id into v_id;
  end if;
  return v_id;
end; $$;

-- ---------------------------------------------------------------------
-- 入庫 : 棚入れ完了
--   inbound_items を done にし、inventory を加算、movement を追加
-- ---------------------------------------------------------------------
create or replace function fn_inbound_putaway(
  p_item_id uuid, p_location uuid, p_qty int
) returns void language plpgsql security definer
set search_path = public as $$
declare
  it inbound_items%rowtype;
  hd inbound_orders%rowtype;
begin
  if not fn_is_operator_or_admin() then raise exception 'forbidden'; end if;
  if p_qty <= 0 then raise exception 'qty must be positive'; end if;

  select * into it from inbound_items where id = p_item_id for update;
  if not found then raise exception 'inbound item not found'; end if;
  if it.status = 'done' then raise exception 'already done'; end if;

  perform fn_inventory_upsert(it.product_id, p_location, it.lot_no, it.expiry, p_qty);

  update inbound_items
     set received_qty = p_qty,
         location_id  = p_location,
         status       = 'done'
   where id = p_item_id;

  insert into inventory_movements(product_id, location_id, lot_no, expiry,
                                  qty_delta, type, ref_type, ref_id, created_by)
  values (it.product_id, p_location, it.lot_no, it.expiry,
          p_qty, 'inbound', 'inbound_items', p_item_id, auth.uid());

  -- ヘッダのステータスを集計
  select * into hd from inbound_orders where id = it.order_id;
  if not exists (select 1 from inbound_items where order_id = hd.id and status <> 'done') then
    update inbound_orders set status = 'done' where id = hd.id;
  end if;
end; $$;

grant execute on function fn_inbound_putaway(uuid, uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- 出庫 : ピッキング完了
--   inventory から引き、outbound_items を shipped にする
-- ---------------------------------------------------------------------
create or replace function fn_outbound_pick(
  p_item_id uuid, p_inventory_id uuid, p_qty int
) returns void language plpgsql security definer
set search_path = public as $$
declare
  it outbound_items%rowtype;
  inv inventory%rowtype;
  hd outbound_orders%rowtype;
begin
  if not fn_is_operator_or_admin() then raise exception 'forbidden'; end if;
  if p_qty <= 0 then raise exception 'qty must be positive'; end if;

  select * into it from outbound_items where id = p_item_id for update;
  if not found then raise exception 'outbound item not found'; end if;
  if it.status in ('shipped') then raise exception 'already shipped'; end if;

  select * into inv from inventory where id = p_inventory_id for update;
  if not found then raise exception 'inventory row not found'; end if;
  if inv.product_id <> it.product_id then raise exception 'product mismatch'; end if;
  if (inv.qty - inv.locked_qty) < p_qty then raise exception 'insufficient available qty'; end if;

  update inventory set qty = qty - p_qty, updated_at = now() where id = inv.id;

  update outbound_items
     set picked_qty       = p_qty,
         from_location_id = inv.location_id,
         lot_no           = inv.lot_no,
         expiry           = inv.expiry,
         status           = 'shipped'
   where id = p_item_id;

  insert into inventory_movements(product_id, location_id, lot_no, expiry,
                                  qty_delta, type, ref_type, ref_id, created_by)
  values (it.product_id, inv.location_id, inv.lot_no, inv.expiry,
          -p_qty, 'outbound', 'outbound_items', p_item_id, auth.uid());

  select * into hd from outbound_orders where id = it.order_id;
  if not exists (select 1 from outbound_items where order_id = hd.id and status <> 'shipped') then
    update outbound_orders set status = 'shipped' where id = hd.id;
  end if;
end; $$;

grant execute on function fn_outbound_pick(uuid, uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- ロケーション移動
-- ---------------------------------------------------------------------
create or replace function fn_inventory_move(
  p_inventory_id uuid, p_to_location uuid, p_qty int
) returns void language plpgsql security definer
set search_path = public as $$
declare
  inv inventory%rowtype;
begin
  if not fn_is_operator_or_admin() then raise exception 'forbidden'; end if;
  if p_qty <= 0 then raise exception 'qty must be positive'; end if;

  select * into inv from inventory where id = p_inventory_id for update;
  if not found then raise exception 'inventory not found'; end if;
  if (inv.qty - inv.locked_qty) < p_qty then raise exception 'insufficient available qty'; end if;
  if inv.location_id = p_to_location then raise exception 'same location'; end if;

  -- 元を減算
  update inventory set qty = qty - p_qty, updated_at = now() where id = inv.id;

  -- 先を加算（同じ SKU/LOT/期限/新ロケで upsert）
  perform fn_inventory_upsert(inv.product_id, p_to_location, inv.lot_no, inv.expiry, p_qty);

  -- ログ 2 行
  insert into inventory_movements(product_id, location_id, lot_no, expiry, qty_delta, type, created_by)
    values (inv.product_id, inv.location_id, inv.lot_no, inv.expiry, -p_qty, 'move_out', auth.uid());
  insert into inventory_movements(product_id, location_id, lot_no, expiry, qty_delta, type, created_by)
    values (inv.product_id, p_to_location, inv.lot_no, inv.expiry, p_qty, 'move_in', auth.uid());
end; $$;

grant execute on function fn_inventory_move(uuid, uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- 棚卸 : スナップショット生成
--   スコープゾーンに属する在庫を stocktake_items に展開
-- ---------------------------------------------------------------------
create or replace function fn_stocktake_snapshot(p_stocktake uuid)
returns int language plpgsql security definer
set search_path = public as $$
declare
  st stocktakes%rowtype;
  n int;
begin
  if not fn_is_admin() then raise exception 'forbidden'; end if;
  select * into st from stocktakes where id = p_stocktake for update;
  if not found then raise exception 'stocktake not found'; end if;
  if st.status <> 'draft' then raise exception 'snapshot only allowed in draft'; end if;

  delete from stocktake_items where stocktake_id = p_stocktake;

  insert into stocktake_items(stocktake_id, location_id, product_id, lot_no, expiry, system_qty)
  select p_stocktake, i.location_id, i.product_id, i.lot_no, i.expiry, i.qty
    from inventory i
    join locations l on l.id = i.location_id
   where (st.scope_zone is null or l.zone = st.scope_zone)
     and i.qty > 0;

  get diagnostics n = row_count;
  update stocktakes set status = 'counting' where id = p_stocktake;
  return n;
end; $$;

grant execute on function fn_stocktake_snapshot(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 棚卸 : 確定（差分反映）
-- ---------------------------------------------------------------------
create or replace function fn_stocktake_confirm(p_stocktake uuid)
returns int language plpgsql security definer
set search_path = public as $$
declare
  st stocktakes%rowtype;
  r  stocktake_items%rowtype;
  n int := 0;
begin
  if not fn_is_admin() then raise exception 'forbidden'; end if;
  select * into st from stocktakes where id = p_stocktake for update;
  if not found then raise exception 'stocktake not found'; end if;
  if st.status not in ('counting','reviewing') then
    raise exception 'confirm only allowed in counting/reviewing';
  end if;

  for r in select * from stocktake_items
            where stocktake_id = p_stocktake
              and counted_qty is not null
              and (counted_qty - system_qty) <> 0
  loop
    perform fn_inventory_upsert(r.product_id, r.location_id, r.lot_no, r.expiry,
                                 r.counted_qty - r.system_qty);
    insert into inventory_movements(product_id, location_id, lot_no, expiry,
                                    qty_delta, type, ref_type, ref_id, note, created_by)
    values (r.product_id, r.location_id, r.lot_no, r.expiry,
            r.counted_qty - r.system_qty, 'adjust', 'stocktakes', p_stocktake,
            'stocktake adjust', auth.uid());
    n := n + 1;
  end loop;

  update stocktakes
     set status = 'done', approved_by = auth.uid(), approved_at = now()
   where id = p_stocktake;
  return n;
end; $$;

grant execute on function fn_stocktake_confirm(uuid) to authenticated;
