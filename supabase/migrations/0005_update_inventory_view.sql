-- =====================================================================
-- LogiStation - 0005_update_inventory_view.sql
-- 在庫ビューに jan_code, updated_at を追加
-- =====================================================================

DROP VIEW IF EXISTS v_inventory_with_names;

CREATE VIEW v_inventory_with_names AS
SELECT
  i.id, i.product_id, p.sku, p.jan_code, p.name AS product_name, p.track_expiry,
  i.location_id, l.code AS location_code, l.zone, l.storage_condition,
  i.lot_no, i.expiry, i.qty, i.locked_qty,
  (i.qty - i.locked_qty) AS available_qty,
  p.min_stock,
  (CASE WHEN i.qty <= p.min_stock THEN true ELSE false END) AS low_stock,
  i.updated_at
FROM inventory i
JOIN products p ON p.id = i.product_id
JOIN locations l ON l.id = i.location_id
WHERE p.deleted_at IS NULL;
