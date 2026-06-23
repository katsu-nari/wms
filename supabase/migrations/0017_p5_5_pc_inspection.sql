-- =====================================================================
-- LogiCore WMS - 0017_p5_5_pc_inspection.sql
-- P5.5: 入荷検品（PCチェック方式）+ 入荷計上
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① inbound_plan_items: 検品チェック列追加
-- ---------------------------------------------------------------------
ALTER TABLE inbound_plan_items
  ADD COLUMN IF NOT EXISTS checked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS checked_by uuid REFERENCES auth.users(id);

-- ---------------------------------------------------------------------
-- ② inbound_receiving_logs: 入荷計上ログ
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inbound_receiving_logs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_plan_id      uuid NOT NULL REFERENCES inbound_plans(id) ON DELETE CASCADE,
  inbound_plan_item_id uuid REFERENCES inbound_plan_items(id) ON DELETE CASCADE,
  product_id           uuid NOT NULL REFERENCES products(id),
  planned_qty          int NOT NULL DEFAULT 0,
  received_qty         int NOT NULL DEFAULT 0,
  variance_qty         int NOT NULL DEFAULT 0,
  received_by          uuid REFERENCES auth.users(id),
  received_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inbound_receiving_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "irl_select" ON inbound_receiving_logs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "irl_insert" ON inbound_receiving_logs
  FOR INSERT TO authenticated WITH CHECK (fn_is_operator_or_admin());

-- ---------------------------------------------------------------------
-- ③ fn_receive_inbound_plan: 入荷計上 (atomic)
--    - ステータスチェック (receiving のみ)
--    - 各明細の received_qty / variance / checked 更新
--    - fn_inventory_upsert で在庫計上
--    - inbound_receiving_logs へ監査ログ挿入
--    - ステータスを completed へ更新
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_receive_inbound_plan(
  p_plan_id     uuid,
  p_location_id uuid,
  p_items       jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_plan           record;
  v_elem           jsonb;
  v_item           record;
  v_received_qty   int;
  v_received_count int := 0;
  v_variance_count int := 0;
  v_total_variance int := 0;
BEGIN
  SELECT * INTO v_plan FROM inbound_plans WHERE id = p_plan_id;
  IF v_plan.id IS NULL OR v_plan.status <> 'receiving' THEN
    RAISE EXCEPTION '検品中の入荷予定のみ入荷計上できます';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM locations WHERE id = p_location_id AND is_active = true) THEN
    RAISE EXCEPTION '有効なロケーションを指定してください';
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT ipi.*, p.sku, p.name AS product_name
    INTO v_item
    FROM inbound_plan_items ipi
    JOIN products p ON p.id = ipi.product_id
    WHERE ipi.id = (v_elem->>'item_id')::uuid
      AND ipi.inbound_plan_id = p_plan_id;

    IF v_item.id IS NULL THEN
      CONTINUE;
    END IF;

    v_received_qty := COALESCE((v_elem->>'received_qty')::int, 0);

    UPDATE inbound_plan_items
    SET received_qty    = v_received_qty,
        variance_qty    = v_received_qty - planned_qty,
        variance_reason = COALESCE(NULLIF(v_elem->>'variance_reason', ''), variance_reason),
        checked         = true,
        checked_at      = now(),
        checked_by      = auth.uid(),
        updated_at      = now(),
        updated_by      = auth.uid()
    WHERE id = v_item.id;

    IF v_received_qty > 0 THEN
      PERFORM fn_inventory_upsert(
        v_item.product_id,
        p_location_id,
        COALESCE(v_item.lot_no, ''),
        v_item.expiry_date,
        v_received_qty
      );
    END IF;

    INSERT INTO inbound_receiving_logs (
      inbound_plan_id, inbound_plan_item_id, product_id,
      planned_qty, received_qty, variance_qty, received_by
    ) VALUES (
      p_plan_id, v_item.id, v_item.product_id,
      v_item.planned_qty, v_received_qty,
      v_received_qty - v_item.planned_qty, auth.uid()
    );

    v_received_count := v_received_count + 1;
    IF v_received_qty <> v_item.planned_qty THEN
      v_variance_count := v_variance_count + 1;
      v_total_variance := v_total_variance + ABS(v_received_qty - v_item.planned_qty);
    END IF;
  END LOOP;

  UPDATE inbound_plan_items
  SET variance_qty = COALESCE(received_qty, 0) - planned_qty,
      updated_at   = now()
  WHERE inbound_plan_id = p_plan_id
    AND variance_qty IS NULL;

  UPDATE inbound_plans
  SET status = 'completed', updated_at = now()
  WHERE id = p_plan_id;

  RETURN jsonb_build_object(
    'received_count',  v_received_count,
    'variance_count',  v_variance_count,
    'total_variance',  v_total_variance
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
