-- =====================================================================
-- LogiCore WMS - 0013_validate_items_v2.sql
-- P4.4 商品照合RPC: JAN専用・sku変数削除・lot_noフィールド削除
-- =====================================================================

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
