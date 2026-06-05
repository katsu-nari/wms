-- =====================================================================
-- LogiCore WMS - 0006_clients.sql
-- 荷主（クライアント）マスタ追加 / 出庫に client_id 追加
-- =====================================================================

-- ---------------------------------------------------------------------
-- clients : 荷主マスタ
-- ---------------------------------------------------------------------
create table if not exists clients (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  contact    text,
  phone      text,
  email      text,
  address    text,
  is_active  bool not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_clients_code on clients (code);

-- updated_at トリガ（fn_set_updated_at は 0001_schema.sql で定義済み）
drop trigger if exists trg_clients_upd on clients;
create trigger trg_clients_upd before update on clients
  for each row execute function fn_set_updated_at();

-- RLS（suppliers と同一パターン）
alter table clients enable row level security;
drop policy if exists clients_read on clients;
create policy clients_read on clients
  for select using (fn_is_authenticated_user());
drop policy if exists clients_admin_write on clients;
create policy clients_admin_write on clients
  for all using (fn_is_admin()) with check (fn_is_admin());

-- ---------------------------------------------------------------------
-- outbound_orders に荷主IDを追加（既存の customer text は残す）
-- ---------------------------------------------------------------------
alter table outbound_orders add column if not exists client_id uuid references clients(id);
