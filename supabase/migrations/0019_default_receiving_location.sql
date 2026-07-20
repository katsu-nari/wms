-- =====================================================================
-- SUPEREX LogiStation - 0019_default_receiving_location.sql
-- 入荷計上の初期ロケーション（入荷仮置き場）N-8888-888 を登録。
-- 棚入れ画面のロケーション選択でこのコードが初期選択される。
-- pick_priority=999 でピッキング優先度は最低に設定。
-- =====================================================================

insert into locations (code, zone, aisle, bin, storage_condition, pick_priority, is_active)
values ('N-8888-888', 'N', '8888', '888', 'ambient', 999, true)
on conflict (code) do nothing;
