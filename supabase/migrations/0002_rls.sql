-- =====================================================================
-- LogiCore WMS - 0002_rls.sql
-- Row Level Security: すべての業務テーブルを有効化し、ロール別権限を設定
-- 対応ドキュメント: docs/02_database_design.md §5, docs/04_architecture.md §4
-- =====================================================================

-- 共通ヘルパ: 現在ユーザのロール
create or replace function fn_current_role() returns text
language sql stable as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function fn_is_admin() returns boolean
language sql stable as $$
  select exists (select 1 from profiles where id = auth.uid() and role='admin');
$$;

create or replace function fn_is_operator_or_admin() returns boolean
language sql stable as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin','operator')
  );
$$;

create or replace function fn_is_authenticated_user() returns boolean
language sql stable as $$
  select exists (select 1 from profiles where id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
alter table profiles enable row level security;

drop policy if exists profiles_self_read on profiles;
create policy profiles_self_read on profiles
  for select using (
    id = auth.uid() or fn_is_admin()
  );

drop policy if exists profiles_admin_write on profiles;
create policy profiles_admin_write on profiles
  for all using (fn_is_admin()) with check (fn_is_admin());

-- ---------------------------------------------------------------------
-- login_attempts
-- ログイン試行記録は anon / authenticated からも insert 許可
-- （失敗時点では認証されていないため）。select は admin のみ。
-- ---------------------------------------------------------------------
alter table login_attempts enable row level security;

drop policy if exists login_attempts_anyone_insert on login_attempts;
create policy login_attempts_anyone_insert on login_attempts
  for insert with check (true);

drop policy if exists login_attempts_admin_select on login_attempts;
create policy login_attempts_admin_select on login_attempts
  for select using (fn_is_admin());

-- ---------------------------------------------------------------------
-- products : 閲覧 = 全ロール, 編集 = admin
-- ---------------------------------------------------------------------
alter table products enable row level security;

drop policy if exists products_read on products;
create policy products_read on products
  for select using (fn_is_authenticated_user());

drop policy if exists products_admin_write on products;
create policy products_admin_write on products
  for all using (fn_is_admin()) with check (fn_is_admin());

-- ---------------------------------------------------------------------
-- locations : 閲覧 = 全ロール, 編集 = admin
-- ---------------------------------------------------------------------
alter table locations enable row level security;

drop policy if exists locations_read on locations;
create policy locations_read on locations
  for select using (fn_is_authenticated_user());

drop policy if exists locations_admin_write on locations;
create policy locations_admin_write on locations
  for all using (fn_is_admin()) with check (fn_is_admin());

-- ---------------------------------------------------------------------
-- inventory : 閲覧 = 全ロール, 編集 = admin/operator
-- ---------------------------------------------------------------------
alter table inventory enable row level security;

drop policy if exists inventory_read on inventory;
create policy inventory_read on inventory
  for select using (fn_is_authenticated_user());

drop policy if exists inventory_op_write on inventory;
create policy inventory_op_write on inventory
  for all using (fn_is_operator_or_admin()) with check (fn_is_operator_or_admin());

-- ---------------------------------------------------------------------
-- inventory_movements : 閲覧 = 全ロール, insert = operator/admin
-- ---------------------------------------------------------------------
alter table inventory_movements enable row level security;

drop policy if exists movements_read on inventory_movements;
create policy movements_read on inventory_movements
  for select using (fn_is_authenticated_user());

drop policy if exists movements_op_insert on inventory_movements;
create policy movements_op_insert on inventory_movements
  for insert with check (fn_is_operator_or_admin());

-- ---------------------------------------------------------------------
-- inbound / outbound : 閲覧 = 全ロール, 編集 = admin/operator
-- ---------------------------------------------------------------------
alter table inbound_orders enable row level security;
drop policy if exists inbound_orders_read on inbound_orders;
create policy inbound_orders_read on inbound_orders
  for select using (fn_is_authenticated_user());
drop policy if exists inbound_orders_op_write on inbound_orders;
create policy inbound_orders_op_write on inbound_orders
  for all using (fn_is_operator_or_admin()) with check (fn_is_operator_or_admin());

alter table inbound_items enable row level security;
drop policy if exists inbound_items_read on inbound_items;
create policy inbound_items_read on inbound_items
  for select using (fn_is_authenticated_user());
drop policy if exists inbound_items_op_write on inbound_items;
create policy inbound_items_op_write on inbound_items
  for all using (fn_is_operator_or_admin()) with check (fn_is_operator_or_admin());

alter table outbound_orders enable row level security;
drop policy if exists outbound_orders_read on outbound_orders;
create policy outbound_orders_read on outbound_orders
  for select using (fn_is_authenticated_user());
drop policy if exists outbound_orders_op_write on outbound_orders;
create policy outbound_orders_op_write on outbound_orders
  for all using (fn_is_operator_or_admin()) with check (fn_is_operator_or_admin());

alter table outbound_items enable row level security;
drop policy if exists outbound_items_read on outbound_items;
create policy outbound_items_read on outbound_items
  for select using (fn_is_authenticated_user());
drop policy if exists outbound_items_op_write on outbound_items;
create policy outbound_items_op_write on outbound_items
  for all using (fn_is_operator_or_admin()) with check (fn_is_operator_or_admin());

-- ---------------------------------------------------------------------
-- stocktakes / stocktake_items
-- 作成/確定 = admin, カウント入力 = operator/admin, 閲覧 = 全員
-- ---------------------------------------------------------------------
alter table stocktakes enable row level security;
drop policy if exists stocktakes_read on stocktakes;
create policy stocktakes_read on stocktakes
  for select using (fn_is_authenticated_user());
drop policy if exists stocktakes_admin_write on stocktakes;
create policy stocktakes_admin_write on stocktakes
  for all using (fn_is_admin()) with check (fn_is_admin());

alter table stocktake_items enable row level security;
drop policy if exists stocktake_items_read on stocktake_items;
create policy stocktake_items_read on stocktake_items
  for select using (fn_is_authenticated_user());
drop policy if exists stocktake_items_op_update on stocktake_items;
create policy stocktake_items_op_update on stocktake_items
  for update using (fn_is_operator_or_admin()) with check (fn_is_operator_or_admin());
drop policy if exists stocktake_items_admin_all on stocktake_items;
create policy stocktake_items_admin_all on stocktake_items
  for all using (fn_is_admin()) with check (fn_is_admin());
