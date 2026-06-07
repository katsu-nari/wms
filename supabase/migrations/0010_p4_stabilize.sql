-- =====================================================================
-- LogiCore WMS - 0010_p4_stabilize.sql
-- P4.2 安定化: RLS修正 / inbound_plan_items 列追加
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① RLS修正: inbound_plans
--    viewer は SELECT のみ / operator 以上が INSERT・UPDATE / admin が DELETE
-- ---------------------------------------------------------------------
drop policy if exists "inbound_plans_insert" on inbound_plans;
drop policy if exists "inbound_plans_update" on inbound_plans;

create policy "inbound_plans_op_insert" on inbound_plans
  for insert to authenticated
  with check (fn_is_operator_or_admin());

create policy "inbound_plans_op_update" on inbound_plans
  for update to authenticated
  using (fn_is_operator_or_admin())
  with check (fn_is_operator_or_admin());

create policy "inbound_plans_admin_delete" on inbound_plans
  for delete to authenticated
  using (fn_is_admin());

-- ---------------------------------------------------------------------
-- ① RLS修正: inbound_plan_items
--    viewer は SELECT のみ / operator 以上が INSERT・UPDATE / admin が DELETE
-- ---------------------------------------------------------------------
drop policy if exists "inbound_plan_items_insert" on inbound_plan_items;
drop policy if exists "inbound_plan_items_update" on inbound_plan_items;

create policy "inbound_plan_items_op_insert" on inbound_plan_items
  for insert to authenticated
  with check (fn_is_operator_or_admin());

create policy "inbound_plan_items_op_update" on inbound_plan_items
  for update to authenticated
  using (fn_is_operator_or_admin())
  with check (fn_is_operator_or_admin());

create policy "inbound_plan_items_admin_delete" on inbound_plan_items
  for delete to authenticated
  using (fn_is_admin());

-- ---------------------------------------------------------------------
-- ② inbound_plan_items: updated_at / updated_by 追加
--    received_qty 変更時の追跡 / 将来のスキャン検品で利用
-- ---------------------------------------------------------------------
alter table inbound_plan_items
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references auth.users(id);

-- 既存行は created_at で初期化
update inbound_plan_items
  set updated_at = created_at
  where updated_at is null;

-- updated_at 自動更新トリガー
create or replace function trg_fn_ipi_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_ipi_updated_at on inbound_plan_items;
create trigger trg_ipi_updated_at
  before update on inbound_plan_items
  for each row execute function trg_fn_ipi_updated_at();
