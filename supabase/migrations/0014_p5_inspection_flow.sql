-- =====================================================================
-- LogiCore WMS - 0014_p5_inspection_flow.sql
-- P5: 入荷予定→検品→入庫確定→在庫計上フロー
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① products: case_qty 追加
-- ---------------------------------------------------------------------
alter table products
  add column if not exists case_qty int not null default 1;

-- ---------------------------------------------------------------------
-- ② inbound_plans: cancelled ステータス + キャンセル理由
-- ---------------------------------------------------------------------
alter table inbound_plans
  add column if not exists cancel_reason text;

-- ---------------------------------------------------------------------
-- ③ inbound_plan_items: 差異数量・差異理由
-- ---------------------------------------------------------------------
alter table inbound_plan_items
  add column if not exists variance_qty int,
  add column if not exists variance_reason text;

-- ---------------------------------------------------------------------
-- ④ inbound_scan_logs: 検品ログテーブル
-- ---------------------------------------------------------------------
create table if not exists inbound_scan_logs (
  id          uuid primary key default gen_random_uuid(),
  inbound_plan_id uuid not null references inbound_plans(id) on delete cascade,
  inbound_plan_item_id uuid references inbound_plan_items(id) on delete cascade,
  product_id  uuid not null references products(id),
  scan_qty    int not null default 1,
  scan_type   text not null default 'single',
  scanned_by  uuid references auth.users(id),
  scanned_at  timestamptz not null default now()
);

alter table inbound_scan_logs enable row level security;

create policy "inbound_scan_logs_select" on inbound_scan_logs
  for select to authenticated using (true);

create policy "inbound_scan_logs_op_insert" on inbound_scan_logs
  for insert to authenticated
  with check (fn_is_operator_or_admin());

-- ---------------------------------------------------------------------
-- ⑤ fn_ip_start_receiving: 検品開始 (planned → receiving)
-- ---------------------------------------------------------------------
create or replace function fn_ip_start_receiving(p_plan_id uuid)
returns void as $$
begin
  update inbound_plans
  set status = 'receiving', updated_at = now()
  where id = p_plan_id and status = 'planned';

  if not found then
    raise exception 'ステータスが予定ではないため検品開始できません';
  end if;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- ⑥ fn_ip_scan_item: 検品スキャン (received_qty加算 + ログ記録)
-- ---------------------------------------------------------------------
create or replace function fn_ip_scan_item(
  p_plan_id uuid,
  p_jan_code text,
  p_qty int default 1,
  p_scan_type text default 'single'
)
returns jsonb as $$
declare
  v_item record;
  v_product record;
  v_new_qty int;
begin
  if not exists (
    select 1 from inbound_plans where id = p_plan_id and status = 'receiving'
  ) then
    raise exception 'この入荷予定は検品中ではありません';
  end if;

  select id, sku, name, jan_code into v_product
  from products
  where jan_code = p_jan_code and deleted_at is null
  limit 1;

  if v_product.id is null then
    raise exception '商品が見つかりません (JAN: %)', p_jan_code;
  end if;

  select id, planned_qty, received_qty into v_item
  from inbound_plan_items
  where inbound_plan_id = p_plan_id and product_id = v_product.id
  limit 1;

  if v_item.id is null then
    raise exception 'この商品は入荷予定に含まれていません';
  end if;

  v_new_qty := coalesce(v_item.received_qty, 0) + p_qty;

  update inbound_plan_items
  set received_qty = v_new_qty,
      updated_at = now(),
      updated_by = auth.uid()
  where id = v_item.id;

  insert into inbound_scan_logs (
    inbound_plan_id, inbound_plan_item_id, product_id,
    scan_qty, scan_type, scanned_by
  ) values (
    p_plan_id, v_item.id, v_product.id,
    p_qty, p_scan_type, auth.uid()
  );

  return jsonb_build_object(
    'product_name', v_product.name,
    'product_sku', v_product.sku,
    'planned_qty', v_item.planned_qty,
    'received_qty', v_new_qty,
    'scan_qty', p_qty
  );
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- ⑦ fn_ip_confirm: 入庫確定 (receiving → completed + 在庫計上)
-- ---------------------------------------------------------------------
create or replace function fn_ip_confirm(
  p_plan_id uuid,
  p_location_id uuid,
  p_variances jsonb default '[]'::jsonb
)
returns void as $$
declare
  v_plan record;
  v_item record;
  v_var jsonb;
begin
  select * into v_plan from inbound_plans where id = p_plan_id;
  if v_plan.id is null or v_plan.status <> 'receiving' then
    raise exception '検品中の入荷予定のみ確定できます';
  end if;

  for v_var in select * from jsonb_array_elements(p_variances)
  loop
    update inbound_plan_items
    set variance_qty = (v_var->>'variance_qty')::int,
        variance_reason = v_var->>'variance_reason'
    where id = (v_var->>'item_id')::uuid
      and inbound_plan_id = p_plan_id;
  end loop;

  for v_item in
    select ipi.*, p.sku
    from inbound_plan_items ipi
    join products p on p.id = ipi.product_id
    where ipi.inbound_plan_id = p_plan_id
      and ipi.received_qty > 0
  loop
    perform fn_inventory_upsert(
      v_item.product_id,
      p_location_id,
      coalesce(v_item.lot_no, ''),
      v_item.expiry_date,
      v_item.received_qty
    );
  end loop;

  update inbound_plan_items
  set variance_qty = coalesce(received_qty, 0) - planned_qty
  where inbound_plan_id = p_plan_id
    and variance_qty is null;

  update inbound_plans
  set status = 'completed', updated_at = now()
  where id = p_plan_id;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- ⑧ fn_ip_cancel: キャンセル (planned → cancelled)
-- ---------------------------------------------------------------------
create or replace function fn_ip_cancel(
  p_plan_id uuid,
  p_reason text
)
returns void as $$
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'キャンセル理由を入力してください';
  end if;

  update inbound_plans
  set status = 'cancelled',
      cancel_reason = p_reason,
      updated_at = now()
  where id = p_plan_id and status = 'planned';

  if not found then
    raise exception '予定ステータスの入荷予定のみキャンセルできます';
  end if;
end;
$$ language plpgsql security definer;
