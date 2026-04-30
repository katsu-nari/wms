-- =====================================================================
-- LogiCore WMS - 0001_schema.sql
-- スキーマ定義: テーブル / インデックス / トリガ
-- 対応ドキュメント: docs/02_database_design.md
-- =====================================================================

-- 拡張（Supabase では既に有効なことが多い）
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- profiles : ユーザー情報 + ロール + ロック状態
-- ---------------------------------------------------------------------
create table if not exists profiles (
  id              uuid primary key references auth.users on delete cascade,
  employee_number text not null unique,
  display_name    text,
  role            text not null default 'viewer'
                  check (role in ('admin','operator','viewer')),
  is_locked       bool not null default false,
  locked_until    timestamptz,
  failed_count    int  not null default 0,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_profiles_emp on profiles (employee_number);

-- ---------------------------------------------------------------------
-- login_attempts : ログイン試行ログ（ブルートフォース対策）
-- ---------------------------------------------------------------------
create table if not exists login_attempts (
  id               bigserial primary key,
  employee_number  text not null,
  success          bool not null,
  ip_address       inet,
  user_agent       text,
  attempted_at     timestamptz not null default now()
);
create index if not exists idx_login_attempts_emp_time
  on login_attempts (employee_number, attempted_at desc);

-- ---------------------------------------------------------------------
-- products : 商品マスタ
-- ---------------------------------------------------------------------
create table if not exists products (
  id                 uuid primary key default gen_random_uuid(),
  sku                text not null unique,
  name               text not null,
  jan_code           text,
  unit               text not null default '個',
  pack_size          int  not null default 1,
  storage_condition  text check (storage_condition in ('ambient','refrigerated','frozen','hazard')),
  min_stock          int  not null default 0,
  track_expiry       bool not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index if not exists idx_products_sku on products (sku) where deleted_at is null;
create index if not exists idx_products_jan on products (jan_code) where deleted_at is null;

-- ---------------------------------------------------------------------
-- locations : ロケーションマスタ
-- ---------------------------------------------------------------------
create table if not exists locations (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  zone              text not null,
  aisle             text,
  rack              text,
  level             text,
  bin               text,
  storage_condition text check (storage_condition in ('ambient','refrigerated','frozen','hazard')),
  capacity          int,
  pick_priority     int not null default 100,
  is_active         bool not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_locations_path
  on locations (zone, aisle, rack, level, bin);

-- ---------------------------------------------------------------------
-- inventory : 現在在庫（SKU × ロット × ロケ × 期限 で一意）
-- ---------------------------------------------------------------------
create table if not exists inventory (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id),
  location_id   uuid not null references locations(id),
  lot_no        text not null default '',
  expiry        date,
  qty           int  not null check (qty >= 0),
  locked_qty    int  not null default 0 check (locked_qty >= 0),
  updated_at    timestamptz not null default now()
);
-- expiry が null のときも UNIQUE を効かせるため COALESCE を使ったユニーク index
create unique index if not exists uq_inventory_slot
  on inventory (product_id, location_id, lot_no, coalesce(expiry, '9999-12-31'::date));
create index if not exists idx_inventory_product on inventory (product_id);
create index if not exists idx_inventory_location on inventory (location_id);
create index if not exists idx_inventory_expiry on inventory (expiry) where expiry is not null;

-- ---------------------------------------------------------------------
-- inventory_movements : 在庫変動ログ（追加のみ・監査用）
-- ---------------------------------------------------------------------
create table if not exists inventory_movements (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id),
  location_id   uuid not null references locations(id),
  lot_no        text not null default '',
  expiry        date,
  qty_delta     int  not null,
  type          text not null check (type in ('inbound','outbound','move_out','move_in','adjust')),
  ref_type      text,
  ref_id        uuid,
  note          text,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists idx_movements_product_time
  on inventory_movements (product_id, created_at desc);
create index if not exists idx_movements_ref
  on inventory_movements (ref_type, ref_id);

-- ---------------------------------------------------------------------
-- inbound_orders / inbound_items
-- ---------------------------------------------------------------------
create table if not exists inbound_orders (
  id           uuid primary key default gen_random_uuid(),
  slip_no      text unique,
  supplier     text,
  planned_date date,
  status       text not null default 'pending'
               check (status in ('pending','received','inspected','putaway','done','canceled')),
  note         text,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists inbound_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references inbound_orders(id) on delete cascade,
  product_id   uuid not null references products(id),
  lot_no       text not null default '',
  expiry       date,
  planned_qty  int  not null check (planned_qty >= 0),
  received_qty int  not null default 0 check (received_qty >= 0),
  location_id  uuid references locations(id),
  status       text not null default 'pending'
               check (status in ('pending','received','putaway','done'))
);
create index if not exists idx_inbound_items_order on inbound_items (order_id);

-- ---------------------------------------------------------------------
-- outbound_orders / outbound_items
-- ---------------------------------------------------------------------
create table if not exists outbound_orders (
  id           uuid primary key default gen_random_uuid(),
  slip_no      text unique,
  customer     text,
  planned_date date,
  status       text not null default 'pending'
               check (status in ('pending','picking','inspected','shipped','canceled')),
  note         text,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists outbound_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references outbound_orders(id) on delete cascade,
  product_id       uuid not null references products(id),
  planned_qty      int  not null check (planned_qty >= 0),
  picked_qty       int  not null default 0 check (picked_qty >= 0),
  from_location_id uuid references locations(id),
  lot_no           text not null default '',
  expiry           date,
  status           text not null default 'pending'
                   check (status in ('pending','picked','inspected','shipped'))
);
create index if not exists idx_outbound_items_order on outbound_items (order_id);

-- ---------------------------------------------------------------------
-- stocktakes / stocktake_items
-- ---------------------------------------------------------------------
create table if not exists stocktakes (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  scope_zone    text,
  planned_date  date,
  status        text not null default 'draft'
                check (status in ('draft','counting','reviewing','done','canceled')),
  created_by    uuid references profiles(id),
  approved_by   uuid references profiles(id),
  created_at    timestamptz not null default now(),
  approved_at   timestamptz
);

create table if not exists stocktake_items (
  id            uuid primary key default gen_random_uuid(),
  stocktake_id  uuid not null references stocktakes(id) on delete cascade,
  location_id   uuid not null references locations(id),
  product_id    uuid not null references products(id),
  lot_no        text not null default '',
  expiry        date,
  system_qty    int  not null,
  counted_qty   int,
  diff          int generated always as (coalesce(counted_qty,0) - system_qty) stored,
  counted_by    uuid references profiles(id),
  counted_at    timestamptz
);
create index if not exists idx_stocktake_items_header on stocktake_items (stocktake_id);
create index if not exists idx_stocktake_items_loc on stocktake_items (location_id);

-- ---------------------------------------------------------------------
-- 便利ビュー : 在庫一覧用に product/location 名を結合済み
-- ---------------------------------------------------------------------
create or replace view v_inventory_with_names as
select
  i.id, i.product_id, p.sku, p.name as product_name, p.track_expiry,
  i.location_id, l.code as location_code, l.zone, l.storage_condition,
  i.lot_no, i.expiry, i.qty, i.locked_qty,
  (i.qty - i.locked_qty) as available_qty,
  p.min_stock,
  (case when i.qty <= p.min_stock then true else false end) as low_stock
from inventory i
join products p on p.id = i.product_id
join locations l on l.id = i.location_id
where p.deleted_at is null;

-- ---------------------------------------------------------------------
-- updated_at 自動更新トリガ
-- ---------------------------------------------------------------------
create or replace function fn_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

do $$
declare t text;
begin
  for t in select unnest(array[
    'profiles','products','locations','inventory',
    'inbound_orders','outbound_orders'
  ])
  loop
    execute format('drop trigger if exists trg_%1$s_upd on %1$s;', t);
    execute format(
      'create trigger trg_%1$s_upd before update on %1$s
       for each row execute function fn_set_updated_at();', t);
  end loop;
end $$;
