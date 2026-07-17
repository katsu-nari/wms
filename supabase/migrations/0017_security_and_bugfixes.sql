-- =====================================================================
-- SUPEREX LogiStation - 0017_security_and_bugfixes.sql
-- 精査で検出した以下を修正する前進マイグレーション:
--   ① RPC権限ギャップ: 0011/0014/0016 の security definer 関数に
--      役割チェック(fn_is_operator_or_admin) と 明示 grant/revoke を追加
--   ② 複数ロット時の棚卸在庫補正漏れ (fn_complete_inventory_count)
--   ③ 同一JAN複数明細での検品数取り違え (fn_ip_scan_item)
--   + fn_ip_cancel を receiving からも取消可能に (中: 検品開始後キャンセル)
--
-- 既存の 0011/0014/0016 は履歴として残し、本ファイルの
-- create or replace が最終的に有効となる。
-- =====================================================================

-- =====================================================================
-- 0011 系: 入荷予定登録 / 商品照合  — 役割チェック追加
-- =====================================================================

create or replace function fn_create_inbound_plan(
  p_planned_date date,
  p_client_id uuid default null,
  p_items jsonb default '[]'::jsonb
)
returns jsonb as $$
declare
  v_plan_no text;
  v_plan_id uuid;
  v_item jsonb;
  v_count int := 0;
begin
  if not fn_is_operator_or_admin() then
    raise exception 'forbidden';
  end if;

  -- 採番
  insert into document_sequences (document_type, document_date, last_seq)
  values ('IP', p_planned_date, 0)
  on conflict (document_type, document_date) do nothing;

  update document_sequences
  set last_seq = last_seq + 1
  where document_type = 'IP'
    and document_date = p_planned_date
  returning last_seq into v_count;

  v_plan_no := 'IP' || to_char(p_planned_date, 'YYYYMMDD') || '-' || lpad(v_count::text, 4, '0');

  -- inbound_plans INSERT
  insert into inbound_plans (plan_no, planned_date, client_id, status, created_by)
  values (v_plan_no, p_planned_date, p_client_id, 'planned', auth.uid())
  returning id into v_plan_id;

  -- inbound_plan_items INSERT
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into inbound_plan_items (
      inbound_plan_id, product_id, planned_qty, received_qty, lot_no, expiry_date
    ) values (
      v_plan_id,
      (v_item->>'product_id')::uuid,
      (v_item->>'planned_qty')::int,
      0,
      nullif(v_item->>'lot_no', ''),
      nullif(v_item->>'expiry_date', '')::date
    );
  end loop;

  return jsonb_build_object(
    'id', v_plan_id,
    'plan_no', v_plan_no,
    'item_count', jsonb_array_length(p_items)
  );
end;
$$ language plpgsql security definer;

create or replace function fn_validate_inbound_items(
  p_items jsonb default '[]'::jsonb
)
returns jsonb as $$
declare
  v_item jsonb;
  v_result jsonb := '[]'::jsonb;
  v_row jsonb;
  v_product record;
  v_idx int := 0;
  v_jan text;
  v_sku text;
  v_qty int;
  v_errors text[];
begin
  if not fn_is_operator_or_admin() then
    raise exception 'forbidden';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_idx := v_idx + 1;
    v_jan := nullif(trim(v_item->>'jan_code'), '');
    v_sku := nullif(trim(v_item->>'sku'), '');
    v_errors := '{}';

    -- 商品検索
    v_product := null;
    if v_jan is not null then
      select id, sku, name, jan_code into v_product
      from products
      where jan_code = v_jan and deleted_at is null
      limit 1;
    end if;
    if v_product.id is null and v_sku is not null then
      select id, sku, name, jan_code into v_product
      from products
      where sku = v_sku and deleted_at is null
      limit 1;
    end if;

    if v_product.id is null then
      v_errors := array_append(v_errors, '商品マスタ未登録 (JAN: ' || coalesce(v_jan, '—') || ', コード: ' || coalesce(v_sku, '—') || ')');
    end if;

    -- 数量チェック
    begin
      v_qty := (v_item->>'planned_qty')::int;
      if v_qty is null or v_qty <= 0 then
        v_errors := array_append(v_errors, '数量が不正です');
      end if;
    exception when others then
      v_errors := array_append(v_errors, '数量が不正です');
      v_qty := null;
    end;

    v_row := jsonb_build_object(
      'row_index', v_idx,
      'product_id', v_product.id,
      'product_name', v_product.name,
      'product_sku', v_product.sku,
      'product_jan', v_product.jan_code,
      'planned_qty', v_qty,
      'lot_no', v_item->>'lot_no',
      'expiry_date', v_item->>'expiry_date',
      'errors', to_jsonb(v_errors)
    );

    v_result := v_result || jsonb_build_array(v_row);
  end loop;

  return v_result;
end;
$$ language plpgsql security definer;

-- =====================================================================
-- 0014 系: 検品フロー — 役割チェック追加 + ③検品配分修正 + キャンセル拡張
-- =====================================================================

create or replace function fn_ip_start_receiving(p_plan_id uuid)
returns void as $$
begin
  if not fn_is_operator_or_admin() then
    raise exception 'forbidden';
  end if;

  update inbound_plans
  set status = 'receiving', updated_at = now()
  where id = p_plan_id and status = 'planned';

  if not found then
    raise exception 'ステータスが予定ではないため検品開始できません';
  end if;
end;
$$ language plpgsql security definer;

-- ③ fn_ip_scan_item: 同一JANが複数明細に分かれている場合、
--    各明細の残り予定数(planned_qty - received_qty)を先頭明細から順に
--    埋め、超過分は最終明細へ計上する。返却値は商品単位の合計。
create or replace function fn_ip_scan_item(
  p_plan_id uuid,
  p_jan_code text,
  p_qty int default 1,
  p_scan_type text default 'single'
)
returns jsonb as $$
declare
  v_product record;
  v_rec     record;
  v_remaining int;
  v_cap     int;
  v_add     int;
  v_first_id uuid;
  v_last_id  uuid;
  v_total_planned int;
  v_total_received int;
begin
  if not fn_is_operator_or_admin() then
    raise exception 'forbidden';
  end if;

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

  if not exists (
    select 1 from inbound_plan_items
    where inbound_plan_id = p_plan_id and product_id = v_product.id
  ) then
    raise exception 'この商品は入荷予定に含まれていません';
  end if;

  -- 残り予定数の少ない/古い明細から順に配分
  v_remaining := p_qty;
  for v_rec in
    select id, planned_qty, coalesce(received_qty, 0) as rq
    from inbound_plan_items
    where inbound_plan_id = p_plan_id and product_id = v_product.id
    order by created_at, id
  loop
    if v_first_id is null then v_first_id := v_rec.id; end if;
    v_last_id := v_rec.id;

    if v_remaining > 0 then
      v_cap := greatest(0, v_rec.planned_qty - v_rec.rq);
      v_add := least(v_cap, v_remaining);
      if v_add > 0 then
        update inbound_plan_items
        set received_qty = v_rec.rq + v_add,
            updated_at = now(),
            updated_by = auth.uid()
        where id = v_rec.id;
        v_remaining := v_remaining - v_add;
      end if;
    end if;
  end loop;

  -- 全明細を予定数まで埋めても余る場合は最終明細に超過計上
  if v_remaining > 0 and v_last_id is not null then
    update inbound_plan_items
    set received_qty = coalesce(received_qty, 0) + v_remaining,
        updated_at = now(),
        updated_by = auth.uid()
    where id = v_last_id;
    v_remaining := 0;
  end if;

  insert into inbound_scan_logs (
    inbound_plan_id, inbound_plan_item_id, product_id,
    scan_qty, scan_type, scanned_by
  ) values (
    p_plan_id, v_first_id, v_product.id,
    p_qty, p_scan_type, auth.uid()
  );

  select coalesce(sum(planned_qty), 0), coalesce(sum(received_qty), 0)
  into v_total_planned, v_total_received
  from inbound_plan_items
  where inbound_plan_id = p_plan_id and product_id = v_product.id;

  return jsonb_build_object(
    'product_name', v_product.name,
    'product_sku', v_product.sku,
    'planned_qty', v_total_planned,
    'received_qty', v_total_received,
    'scan_qty', p_qty
  );
end;
$$ language plpgsql security definer;

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
  if not fn_is_operator_or_admin() then
    raise exception 'forbidden';
  end if;

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

-- fn_ip_cancel: planned に加え receiving からも取消可能に。
-- (在庫は確定時のみ計上されるため receiving での取消は安全)
create or replace function fn_ip_cancel(
  p_plan_id uuid,
  p_reason text
)
returns void as $$
begin
  if not fn_is_operator_or_admin() then
    raise exception 'forbidden';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'キャンセル理由を入力してください';
  end if;

  update inbound_plans
  set status = 'cancelled',
      cancel_reason = p_reason,
      updated_at = now()
  where id = p_plan_id and status in ('planned', 'receiving');

  if not found then
    raise exception '予定または検品中の入荷予定のみキャンセルできます';
  end if;
end;
$$ language plpgsql security definer;

-- =====================================================================
-- 0016 系: 棚卸 — 役割チェック追加 + ②複数ロット補正修正
-- =====================================================================

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
  if not fn_is_operator_or_admin() then
    raise exception 'forbidden';
  end if;

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
  if not fn_is_operator_or_admin() then
    raise exception 'forbidden';
  end if;

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

-- ② fn_complete_inventory_count: 在庫補正を「ロケーション×商品の実合計」が
--    count_qty に一致するようロット横断で調整する。
--    - 不足(負差異): 数量の多いロットから順に減算しクランプ、残りを次ロットへ
--    - 過剰(正差異): 最大ロットに加算、行が無ければ空ロットを新規作成
--    variance_qty / 差異履歴は開始時スナップショット(system_qty)基準を維持。
create or replace function fn_complete_inventory_count(p_count_id uuid)
returns jsonb as $$
declare
  v_count      record;
  v_item       record;
  v_lot        record;
  v_inv_id     uuid;
  v_delta      int;    -- スナップショット差異(表示・監査用)
  v_actual     int;    -- 現在の実在庫合計
  v_phys_delta int;    -- 実在庫に対する補正量
  v_remaining  int;
  v_take       int;
  v_adjusted   int := 0;
  v_total      int := 0;
begin
  if not fn_is_operator_or_admin() then
    raise exception 'forbidden';
  end if;

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
      -- 現在の実在庫合計(全ロット)を取得し、count_qty へ物理的に一致させる
      select coalesce(sum(qty), 0) into v_actual
      from inventory
      where product_id = v_item.product_id and location_id = v_item.location_id;

      v_phys_delta := v_item.count_qty - v_actual;

      if v_phys_delta > 0 then
        -- 過剰: 最大ロットに加算、無ければ空ロットを新規作成
        select id into v_inv_id from inventory
        where product_id = v_item.product_id and location_id = v_item.location_id
        order by qty desc limit 1;

        if v_inv_id is not null then
          update inventory
          set qty = qty + v_phys_delta, updated_at = now()
          where id = v_inv_id;
        else
          insert into inventory (product_id, location_id, lot_no, qty)
          values (v_item.product_id, v_item.location_id, '', v_item.count_qty);
        end if;
      elsif v_phys_delta < 0 then
        -- 不足: 数量の多いロットから順に減算(クランプしつつ残りを次へ)
        v_remaining := -v_phys_delta;
        for v_lot in
          select id, qty from inventory
          where product_id = v_item.product_id
            and location_id = v_item.location_id
            and qty > 0
          order by qty desc
        loop
          exit when v_remaining <= 0;
          v_take := least(v_lot.qty, v_remaining);
          update inventory
          set qty = qty - v_take, updated_at = now()
          where id = v_lot.id;
          v_remaining := v_remaining - v_take;
        end loop;
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

-- =====================================================================
-- ① 明示的な実行権限: security definer 業務RPC は authenticated のみ許可
--    (anon からの直接呼び出しを遮断。関数内でさらに operator/admin を要求)
--    ※ ログイン系 (fn_check_login_allowed / fn_record_login_attempt) は
--      認証前に anon が呼ぶため対象外。
-- =====================================================================

revoke execute on function fn_create_inbound_plan(date, uuid, jsonb) from public;
revoke execute on function fn_validate_inbound_items(jsonb) from public;
revoke execute on function fn_ip_start_receiving(uuid) from public;
revoke execute on function fn_ip_scan_item(uuid, text, int, text) from public;
revoke execute on function fn_ip_confirm(uuid, uuid, jsonb) from public;
revoke execute on function fn_ip_cancel(uuid, text) from public;
revoke execute on function fn_start_inventory_count(text, uuid, uuid) from public;
revoke execute on function fn_scan_inventory_count(uuid, text, int) from public;
revoke execute on function fn_complete_inventory_count(uuid) from public;

grant execute on function fn_create_inbound_plan(date, uuid, jsonb) to authenticated;
grant execute on function fn_validate_inbound_items(jsonb) to authenticated;
grant execute on function fn_ip_start_receiving(uuid) to authenticated;
grant execute on function fn_ip_scan_item(uuid, text, int, text) to authenticated;
grant execute on function fn_ip_confirm(uuid, uuid, jsonb) to authenticated;
grant execute on function fn_ip_cancel(uuid, text) to authenticated;
grant execute on function fn_start_inventory_count(text, uuid, uuid) to authenticated;
grant execute on function fn_scan_inventory_count(uuid, text, int) to authenticated;
grant execute on function fn_complete_inventory_count(uuid) to authenticated;
