-- =====================================================================
-- LogiCore WMS - 0009_plan_no_rpc.sql
-- 伝票番号採番: 排他ロック付きRPC
-- =====================================================================

-- ---------------------------------------------------------------------
-- document_sequences : 伝票番号シーケンス管理
-- ---------------------------------------------------------------------
create table if not exists document_sequences (
  document_type text not null,
  document_date date not null,
  last_seq      int  not null default 0,
  primary key (document_type, document_date)
);

alter table document_sequences enable row level security;
create policy "document_sequences_all" on document_sequences
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- fn_generate_plan_no : 採番関数（排他ロック付き）
-- ---------------------------------------------------------------------
create or replace function fn_generate_plan_no(
  p_document_type text,
  p_date date
)
returns text as $$
declare
  v_prefix text;
  v_seq int;
begin
  v_prefix := p_document_type || to_char(p_date, 'YYYYMMDD');

  insert into document_sequences (document_type, document_date, last_seq)
  values (p_document_type, p_date, 0)
  on conflict (document_type, document_date) do nothing;

  update document_sequences
  set last_seq = last_seq + 1
  where document_type = p_document_type
    and document_date = p_date
  returning last_seq into v_seq;

  return v_prefix || '-' || lpad(v_seq::text, 4, '0');
end;
$$ language plpgsql;
