-- =====================================================================
-- LogiCore WMS - 0007_location_map.sql
-- ロケーション別在庫集計ビュー（ロケーションマップ用）
-- =====================================================================

CREATE OR REPLACE VIEW v_location_summary AS
SELECT
  l.id,
  l.code,
  l.zone,
  l.aisle,
  l.rack,
  l.level,
  l.bin,
  l.is_active,
  COALESCE(SUM(i.qty), 0)::int AS total_qty,
  COUNT(DISTINCT i.product_id) FILTER (WHERE i.qty > 0)::int AS product_count
FROM locations l
LEFT JOIN inventory i ON i.location_id = l.id AND i.qty > 0
GROUP BY l.id;
