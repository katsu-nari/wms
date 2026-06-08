-- =====================================================================
-- LogiCore WMS - 0015_p6_location_mgmt.sql
-- P6: ロケーション管理強化 (詳細・検索・QR・KPI)
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① v_inventory_by_location: ロケーション×商品の在庫集計ビュー
--    ※ inventory テーブルが既に product_id + location_id で在庫を管理
--      しているため、新規テーブルは不要。このビューで集計表示を実現。
-- ---------------------------------------------------------------------
create or replace view v_inventory_by_location as
select
  i.location_id,
  l.code  as location_code,
  l.zone,
  i.product_id,
  p.sku,
  p.name  as product_name,
  p.jan_code,
  sum(i.qty)::int        as total_qty,
  sum(i.locked_qty)::int as total_locked,
  count(*)::int          as lot_count
from inventory i
join products  p on p.id = i.product_id and p.deleted_at is null
join locations l on l.id = i.location_id
where i.qty > 0
group by i.location_id, l.code, l.zone,
         i.product_id, p.sku, p.name, p.jan_code;
