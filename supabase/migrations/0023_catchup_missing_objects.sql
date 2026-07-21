-- =====================================================================
-- SUPEREX LogiStation - 0023_catchup_missing_objects.sql
-- 本番DBで未適用だったマイグレーション由来の欠落オブジェクトを復元。
-- すべて存在チェック/CREATE IF NOT EXISTS/DROP POLICY IF EXISTS により
-- 冪等(何度実行しても安全)。
--
-- 対象:
--   0009  document_sequences (採番テーブル) … 棚卸番号採番で使用
--   0015  v_inventory_by_location (ビュー)  … ロケーション商品検索
--   0016  inventory_counts / _items / _adjustments … 棚卸機能
--   0019  N-8888-888 ロケーション          … 入荷計上の初期ロケ
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0009: 採番テーブル
-- ---------------------------------------------------------------------
create table if not exists document_sequences (
  document_type text not null,
  document_date date not null,
  last_seq      int  not null default 0,
  primary key (document_type, document_date)
);
alter table document_sequences enable row level security;
drop policy if exists "document_sequences_all" on document_sequences;
drop policy if exists "document_sequences_op" on document_sequences;
create policy "document_sequences_op" on document_sequences
  for all to authenticated
  using (fn_is_operator_or_admin()) with check (fn_is_operator_or_admin());

-- ---------------------------------------------------------------------
-- 0015: ロケーション×商品 在庫集計ビュー (security_invoker適用)
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
alter view v_inventory_by_location set (security_invoker = on);

-- ---------------------------------------------------------------------
-- 0016: 棚卸テーブル群
-- ---------------------------------------------------------------------
create table if not exists inventory_counts (
  id                 uuid primary key default gen_random_uuid(),
  count_no           text not null unique,
  count_type         text not null check (count_type in ('location','product')),
  status             text not null default 'counting' check (status in ('counting','completed')),
  target_location_id uuid references locations(id),
  target_product_id  uuid references products(id),
  started_by         uuid references auth.users(id),
  started_at         timestamptz not null default now(),
  completed_by       uuid references auth.users(id),
  completed_at       timestamptz,
  created_at         timestamptz not null default now()
);
alter table inventory_counts enable row level security;
drop policy if exists "ic_select" on inventory_counts;
drop policy if exists "ic_insert" on inventory_counts;
drop policy if exists "ic_update" on inventory_counts;
create policy "ic_select" on inventory_counts for select to authenticated using (true);
create policy "ic_insert" on inventory_counts for insert to authenticated with check (fn_is_operator_or_admin());
create policy "ic_update" on inventory_counts for update to authenticated using (fn_is_operator_or_admin());

create table if not exists inventory_count_items (
  id                  uuid primary key default gen_random_uuid(),
  inventory_count_id  uuid not null references inventory_counts(id) on delete cascade,
  product_id          uuid not null references products(id),
  location_id         uuid not null references locations(id),
  system_qty          int not null default 0,
  count_qty           int,
  variance_qty        int,
  reason              text,
  created_at          timestamptz not null default now()
);
alter table inventory_count_items enable row level security;
drop policy if exists "ici_select" on inventory_count_items;
drop policy if exists "ici_insert" on inventory_count_items;
drop policy if exists "ici_update" on inventory_count_items;
create policy "ici_select" on inventory_count_items for select to authenticated using (true);
create policy "ici_insert" on inventory_count_items for insert to authenticated with check (fn_is_operator_or_admin());
create policy "ici_update" on inventory_count_items for update to authenticated using (fn_is_operator_or_admin());

create table if not exists inventory_adjustments (
  id                  uuid primary key default gen_random_uuid(),
  inventory_count_id  uuid references inventory_counts(id),
  product_id          uuid not null references products(id),
  location_id         uuid not null references locations(id),
  before_qty          int not null,
  after_qty           int not null,
  variance_qty        int not null,
  reason              text,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now()
);
alter table inventory_adjustments enable row level security;
drop policy if exists "ia_select" on inventory_adjustments;
drop policy if exists "ia_insert" on inventory_adjustments;
create policy "ia_select" on inventory_adjustments for select to authenticated using (true);
create policy "ia_insert" on inventory_adjustments for insert to authenticated with check (fn_is_operator_or_admin());

-- ---------------------------------------------------------------------
-- 0019: 入荷計上の初期ロケーション(入荷仮置き場)
-- ---------------------------------------------------------------------
insert into locations (code, zone, aisle, bin, storage_condition, pick_priority, is_active)
values ('N-8888-888', 'N', '8888', '888', 'ambient', 999, true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 追いつき後: authenticated 権限を再付与
-- (0022 の anon 剥奪は anon のみ対象だが、新規オブジェクトの権限を明示)
-- ---------------------------------------------------------------------
grant select, insert, update, delete on
  document_sequences, inventory_counts, inventory_count_items, inventory_adjustments
  to authenticated;
grant select on v_inventory_by_location to authenticated;
