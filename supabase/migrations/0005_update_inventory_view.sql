-- =====================================================================
-- LogiStation - 0005_update_inventory_view.sql
-- 在庫ビューに jan_code, updated_at を追加
-- =====================================================================

create or replace view v_inventory_with_names as
select
  i.id, i.product_id, p.sku, p.jan_code, p.name as product_name, p.track_expiry,
  i.location_id, l.code as location_code, l.zone, l.storage_condition,
  i.lot_no, i.expiry, i.qty, i.locked_qty,
  (i.qty - i.locked_qty) as available_qty,
  p.min_stock,
  (case when i.qty <= p.min_stock then true else false end) as low_stock,
  i.updated_at
from inventory i
join products p on p.id = i.product_id
join locations l on l.id = i.location_id
where p.deleted_at is null;
