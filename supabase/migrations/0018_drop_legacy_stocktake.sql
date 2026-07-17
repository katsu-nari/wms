-- =====================================================================
-- SUPEREX LogiStation - 0018_drop_legacy_stocktake.sql
-- 旧棚卸システム(未使用デッドコード)の削除。
--
-- P7 (0016) で inventory_counts / inventory_count_items /
-- inventory_adjustments へ全面移行済み。旧 stocktakes 系は
-- フロントエンド(js/)から一切参照されていない。
--
-- ⚠ 破壊的操作: 旧テーブルにデータが残っている場合は消えます。
--   本番適用前に stocktakes / stocktake_items が空であることを確認してください:
--     select count(*) from stocktakes;
--     select count(*) from stocktake_items;
--   移行済みで問題なければ本ファイルを実行してください(任意)。
-- =====================================================================

drop function if exists fn_stocktake_confirm(uuid);
drop function if exists fn_stocktake_snapshot(uuid);

-- stocktake_items は stocktakes を FK 参照(on delete cascade)。
drop table if exists stocktake_items cascade;
drop table if exists stocktakes cascade;
