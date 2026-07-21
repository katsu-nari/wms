-- =====================================================================
-- SUPEREX LogiStation - 0022_security_hardening.sql
-- セキュリティ監査(2026-07-21)で検出した問題の修正:
--
--  【高】① ビューのRLS迂回を修正
--    v_inventory_with_names / v_inventory_by_location に security_invoker
--    が無く、ビューがオーナー(postgres)権限で実行されるため RLS を迂回。
--    公開済みの anon キーだけで未ログインでも全在庫・商品・ロケーション
--    データが読み取れる状態だった。
--
--  【高】② anon ロールの既定権限を剥奪(多層防御)
--    Supabase の既定で anon にテーブル/ビュー/関数への広い権限が付与
--    されている。未ログインで必要なのはログイン系RPC2本のみのため、
--    それ以外を全て revoke。
--
--  【中】③ document_sequences(採番)の書込を operator/admin に限定
--    従来は viewer を含む全認証ユーザーが書換可能だった。
--
--  【中】④ login_attempts への直接insertを封鎖
--    記録は security definer 関数(fn_record_login_attempt)経由のみに。
--    従来は anon が直接insertでき、ゴミデータ蓄積が可能だった。
--
--  【中】⑤ ログイン系RPCに入力形式検証を追加
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① ビューを呼び出し元権限(security_invoker)で実行し RLS を適用
--    存在するビューにのみ適用(未適用マイグレーションによる欠落に備える)
-- ---------------------------------------------------------------------
do $$
declare
  v text;
begin
  foreach v in array array[
    'v_inventory_with_names',
    'v_inventory_by_location',
    'v_location_summary'
  ] loop
    if exists (select 1 from pg_views where schemaname = 'public' and viewname = v) then
      execute format('alter view public.%I set (security_invoker = on)', v);
    else
      raise notice 'view % not found, skipped', v;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- ② anon の権限剥奪。未ログインに必要なのはログインRPC2本のみ
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;

grant execute on function fn_check_login_allowed(text) to anon;
grant execute on function fn_record_login_attempt(text, boolean) to anon;

-- 今後 postgres ロールで作成するオブジェクトにも同様の既定を適用
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- ---------------------------------------------------------------------
-- ③ 採番テーブルは operator/admin のみ書込可(存在する場合のみ)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='document_sequences') then
    drop policy if exists "document_sequences_all" on document_sequences;
    drop policy if exists "document_sequences_op" on document_sequences;
    create policy "document_sequences_op" on document_sequences
      for all to authenticated
      using (fn_is_operator_or_admin()) with check (fn_is_operator_or_admin());
  else
    raise notice 'table document_sequences not found, skipped';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- ④ login_attempts の直接insertを封鎖(definer関数経由のみ)(存在する場合のみ)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='login_attempts') then
    drop policy if exists login_attempts_anyone_insert on login_attempts;
  else
    raise notice 'table login_attempts not found, skipped';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- ⑤ ログイン系RPC: 社員番号の形式検証を追加
--    (不正な形式の場合は記録もチェックもせず即応答)
-- ---------------------------------------------------------------------
create or replace function fn_check_login_allowed(emp text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  p profiles%rowtype;
begin
  if emp is null or emp !~ '^[A-Za-z0-9_-]{1,20}$' then
    return jsonb_build_object('ok', false, 'code', 'bad_request',
      'message', '社員番号の形式が不正です');
  end if;

  select * into p from profiles where employee_number = emp;
  if not found then
    -- ユーザーが存在しなくても攻撃者に情報を与えないので OK を返す
    return jsonb_build_object('ok', true);
  end if;
  if p.is_locked then
    return jsonb_build_object('ok', false, 'code','locked',
      'message','アカウントがロックされています。管理者に連絡してください');
  end if;
  if p.locked_until is not null and p.locked_until > now() then
    return jsonb_build_object('ok', false, 'code','cooldown',
      'message', format('一時ロック中です。%s秒後に再試行してください',
                        extract(epoch from (p.locked_until - now()))::int));
  end if;
  return jsonb_build_object('ok', true);
end; $$;

create or replace function fn_record_login_attempt(emp text, ok boolean)
returns void language plpgsql security definer
set search_path = public as $$
declare
  fail_15 int;
  fail_24 int;
begin
  if emp is null or emp !~ '^[A-Za-z0-9_-]{1,20}$' then
    return;   -- 不正形式は記録しない(ゴミデータ・ログ汚染防止)
  end if;

  insert into login_attempts(employee_number, success)
    values (emp, ok);

  if not exists (select 1 from profiles where employee_number = emp) then
    return;
  end if;

  if ok then
    update profiles
       set failed_count = 0, locked_until = null, last_login_at = now()
     where employee_number = emp;
    return;
  end if;

  select count(*) into fail_15 from login_attempts
    where employee_number = emp and success = false
      and attempted_at > now() - interval '15 minutes';

  select count(*) into fail_24 from login_attempts
    where employee_number = emp and success = false
      and attempted_at > now() - interval '24 hours';

  update profiles
     set failed_count = fail_15,
         locked_until = case when fail_15 >= 5 then now() + interval '15 minutes' else locked_until end,
         is_locked    = case when fail_24 >= 20 then true else is_locked end
   where employee_number = emp;
end; $$;

-- 再定義後の実行権限を明示(②のrevokeの後に再グラント)
revoke execute on function fn_check_login_allowed(text) from public;
revoke execute on function fn_record_login_attempt(text, boolean) from public;
grant execute on function fn_check_login_allowed(text) to anon, authenticated;
grant execute on function fn_record_login_attempt(text, boolean) to anon, authenticated;
