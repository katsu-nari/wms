-- =====================================================================
-- LogiCore WMS - 0008_inbound_plans.sql
-- 入荷予定管理テーブル
-- =====================================================================

-- ---------------------------------------------------------------------
-- inbound_plans : 入荷予定ヘッダー
-- ---------------------------------------------------------------------
create table if not exists inbound_plans (
  id           uuid primary key default gen_random_uuid(),
  plan_no      text not null unique,
  planned_date date not null,
  client_id    uuid references clients(id),
  status       text not null default 'planned'
               check (status in ('planned','receiving','completed')),
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_inbound_plans_status on inbound_plans (status);
create index if not exists idx_inbound_plans_date on inbound_plans (planned_date desc);
create index if not exists idx_inbound_plans_client on inbound_plans (client_id);

-- ---------------------------------------------------------------------
-- inbound_plan_items : 入荷予定明細
-- ---------------------------------------------------------------------
create table if not exists inbound_plan_items (
  id               uuid primary key default gen_random_uuid(),
  inbound_plan_id  uuid not null references inbound_plans(id) on delete cascade,
  product_id       uuid not null references products(id),
  planned_qty      int not null check (planned_qty > 0),
  received_qty     int not null default 0,
  lot_no           text,
  expiry_date      date,
  created_at       timestamptz not null default now()
);
create index if not exists idx_inbound_plan_items_plan on inbound_plan_items (inbound_plan_id);
create index if not exists idx_inbound_plan_items_product on inbound_plan_items (product_id);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table inbound_plans enable row level security;
alter table inbound_plan_items enable row level security;

create policy "inbound_plans_select" on inbound_plans for select to authenticated using (true);
create policy "inbound_plans_insert" on inbound_plans for insert to authenticated with check (true);
create policy "inbound_plans_update" on inbound_plans for update to authenticated using (true);

create policy "inbound_plan_items_select" on inbound_plan_items for select to authenticated using (true);
create policy "inbound_plan_items_insert" on inbound_plan_items for insert to authenticated with check (true);
create policy "inbound_plan_items_update" on inbound_plan_items for update to authenticated using (true);

-- updated_at trigger
create or replace function trg_inbound_plans_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_inbound_plans_updated_at
  before update on inbound_plans
  for each row execute function trg_inbound_plans_updated_at();
