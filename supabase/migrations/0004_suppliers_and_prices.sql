-- =====================================================================
-- LogiCore WMS - 0004_suppliers_and_prices.sql
-- 仕入先マスタ追加 / 商品に原単価・売単価追加 / 入庫明細に価格・ケース数追加
-- =====================================================================

-- ---------------------------------------------------------------------
-- suppliers : 仕入先マスタ
-- ---------------------------------------------------------------------
create table if not exists suppliers (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  contact    text,
  phone      text,
  email      text,
  is_active  bool not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_suppliers_code on suppliers (code);

-- updated_at トリガ
drop trigger if exists trg_suppliers_upd on suppliers;
create trigger trg_suppliers_upd before update on suppliers
  for each row execute function fn_set_updated_at();

-- RLS
alter table suppliers enable row level security;
drop policy if exists suppliers_read on suppliers;
create policy suppliers_read on suppliers
  for select using (fn_is_authenticated_user());
drop policy if exists suppliers_admin_write on suppliers;
create policy suppliers_admin_write on suppliers
  for all using (fn_is_admin()) with check (fn_is_admin());

-- ---------------------------------------------------------------------
-- products に原単価・売単価を追加
-- ---------------------------------------------------------------------
alter table products add column if not exists cost_price numeric(12,2);
alter table products add column if not exists sell_price numeric(12,2);

-- ---------------------------------------------------------------------
-- inbound_orders に仕入先IDを追加（既存の supplier text は残す）
-- ---------------------------------------------------------------------
alter table inbound_orders add column if not exists supplier_id uuid references suppliers(id);

-- ---------------------------------------------------------------------
-- inbound_items に価格・ケース数を追加
-- ---------------------------------------------------------------------
alter table inbound_items add column if not exists cost_price numeric(12,2);
alter table inbound_items add column if not exists sell_price numeric(12,2);
alter table inbound_items add column if not exists case_qty int not null default 0;
alter table inbound_items add column if not exists piece_qty int not null default 0;
alter table inbound_items add column if not exists pack_size int not null default 1;
