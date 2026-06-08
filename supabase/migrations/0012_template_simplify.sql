-- =====================================================================
-- LogiCore WMS - 0012_template_simplify.sql
-- テンプレート仕様変更: 商品コード列・ロットNo列削除、JAN照合のみ
-- =====================================================================

-- ---------------------------------------------------------------------
-- fn_create_inbound_plan : lot_no を任意パラメータとして維持しつつ
--   Excel取込時は送信しない運用に対応
--   （既存RPC定義を CREATE OR REPLACE で上書き）
-- ---------------------------------------------------------------------
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
  insert into document_sequences (document_type, document_date, last_seq)
  values ('IP', p_planned_date, 0)
  on conflict (document_type, document_date) do nothing;

  update document_sequences
  set last_seq = last_seq + 1
  where document_type = 'IP'
    and document_date = p_planned_date
  returning last_seq into v_count;

  v_plan_no := 'IP' || to_char(p_planned_date, 'YYYYMMDD') || '-' || lpad(v_count::text, 4, '0');

  insert into inbound_plans (plan_no, planned_date, client_id, status, created_by)
  values (v_plan_no, p_planned_date, p_client_id, 'planned', auth.uid())
  returning id into v_plan_id;

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

-- ---------------------------------------------------------------------
-- fn_validate_inbound_items : JAN照合のみ（SKUフォールバック削除）
-- ---------------------------------------------------------------------
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
  v_qty int;
  v_errors text[];
begin
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_idx := v_idx + 1;
    v_jan := nullif(trim(v_item->>'jan_code'), '');
    v_errors := '{}';

    v_product := null;
    if v_jan is not null then
      select id, sku, name, jan_code into v_product
      from products
      where jan_code = v_jan and deleted_at is null
      limit 1;
    end if;

    if v_product.id is null then
      v_errors := array_append(v_errors, '商品マスタ未登録 (JAN: ' || coalesce(v_jan, '—') || ')');
    end if;

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
      'expiry_date', v_item->>'expiry_date',
      'errors', to_jsonb(v_errors)
    );

    v_result := v_result || jsonb_build_array(v_row);
  end loop;

  return v_result;
end;
$$ language plpgsql security definer;
