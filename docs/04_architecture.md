# LogiCore WMS アーキテクチャ・認証設計書

## 1. アーキテクチャ概要

```
┌─────────────────────────────────────────────────┐
│               Client (Browser / PWA)            │
│  HTML + Vanilla JS / もしくは Next.js(App Router)│
│  - Supabase JS SDK                              │
│  - BarcodeDetector / ZXing-js (スキャン)        │
└────────────┬──────────────────┬─────────────────┘
             │ HTTPS            │ HTTPS (WebSocket)
             ▼                  ▼
      ┌──────────────┐    ┌──────────────┐
      │ Supabase REST │    │ Supabase     │
      │  (PostgREST)  │    │  Realtime    │
      └──────┬────────┘    └──────┬───────┘
             ▼                    ▼
      ┌──────────────────────────────┐
      │     PostgreSQL (RLS 有効)    │
      │  - profiles / products       │
      │  - inventory / movements     │
      │  - inbound / outbound        │
      │  - stocktakes                │
      └──────────┬───────────────────┘
                 ▼
            ┌──────────┐
            │ Supabase │
            │   Auth   │
            └──────────┘
```

- フロントは **Supabase JS SDK** を介して REST / Realtime / Auth に直接アクセス
- サーバロジックが必要な処理（棚卸確定、移動トランザクション等）は
  **PostgreSQL 関数 (RPC)** として実装し、トランザクション境界を DB 側に寄せる
- 複雑なバッチ処理（CSV インポート検証など）は **Supabase Edge Functions** に切り出す

## 2. 技術スタック候補

| 層 | P1 での最小構成 | 将来構成 |
|----|------------------|----------|
| フロント | 既存 `wms_supabase.html` をベースに画面分割 | Next.js 14 App Router + TypeScript |
| UI | Vanilla CSS（現 `:root` 変数方式） | Tailwind CSS + shadcn/ui |
| 状態管理 | グローバル `S = {}` オブジェクト | Zustand / TanStack Query |
| スキャン | `BarcodeDetector` + ZXing-js フォールバック | 同左 |
| バックエンド | Supabase（PostgREST + Auth + RLS） | 同左（+ Edge Functions） |
| 帳票 | クライアント側 CSV 生成 | Edge Function で整形 |
| デプロイ | GitHub Pages / Vercel Static | Vercel + Supabase プロジェクト |

本プロジェクトは **P1 では既存 HTML の延長線** で始め、規模拡大に応じて Next.js へ移行する想定。

## 3. ディレクトリ構成（案）

```
wms/
├─ docs/                           # 設計ドキュメント
│  ├─ 01_requirements.md
│  ├─ 02_database_design.md
│  ├─ 03_screen_design.md
│  └─ 04_architecture.md
├─ supabase/
│  ├─ migrations/                  # DDL 群（番号付き SQL）
│  │  ├─ 0001_init.sql
│  │  ├─ 0002_rls.sql
│  │  └─ 0003_rpc_functions.sql
│  ├─ seed.sql
│  └─ functions/                   # Edge Functions（必要時）
├─ public/
│  └─ index.html                   # エントリ（現 wms_supabase.html の後継）
├─ src/                            # JS モジュール（P1 以降で分割）
│  ├─ lib/
│  │  ├─ supabase.js
│  │  └─ auth.js
│  ├─ pages/
│  │  ├─ dashboard.js
│  │  ├─ inventory.js
│  │  ├─ inbound.js
│  │  ├─ outbound.js
│  │  ├─ move.js
│  │  ├─ stocktake.js
│  │  └─ ...
│  └─ components/
├─ wms_supabase.html               # 既存プロトタイプ（参照用に保持）
└─ README.md
```

## 4. 認証設計

### 4.1 Supabase Auth（社員番号 + 数字5桁 PIN 方式）
- **ログインID は「社員番号」** (例 `E00123`)、**パスワードは「数字5桁」** (`00000`〜`99999`)
- Supabase Auth はメール/パスワード基盤しか持たないため、内部で
  **擬似メールへの変換レイヤ**を噛ませる:
  - `email = {employee_number}@wms.internal`
  - `password = <入力された5桁数字>`
- 画面にはメールアドレスを露出させない。ログイン UI は「社員番号」「パスワード」のみ
- セッションは localStorage に保存（Supabase JS SDK デフォルト）
- サインアップは **管理者が UI から発行**。オープン登録は無効化
- admin が新規ユーザー作成時、擬似メール + 初期5桁PINで `auth.admin.createUser` を呼び、
  同時に `profiles.employee_number` を登録する

#### クライアント側 ログイン疑似コード
```js
async function login(empNo, pin) {
  // 形式バリデーション
  if (!/^[A-Za-z0-9]{3,20}$/.test(empNo)) throw new Error('社員番号の形式エラー');
  if (!/^\d{5}$/.test(pin))               throw new Error('パスワードは数字5桁');

  // 事前にロック状態を確認（public.fn_check_login_allowed を RPC 経由で呼び出す）
  const { data: allowed } = await supabase.rpc('fn_check_login_allowed', { emp: empNo });
  if (!allowed.ok) throw new Error(allowed.message);

  const email = `${empNo.toLowerCase()}@wms.internal`;
  const { error } = await supabase.auth.signInWithPassword({ email, password: pin });

  // 成否を login_attempts に記録（RPC: fn_record_login_attempt）
  await supabase.rpc('fn_record_login_attempt', { emp: empNo, success: !error });

  if (error) throw new Error('社員番号またはパスワードが違います');
}
```

### 4.1.1 ブルートフォース対策
5桁数字は **10 万通り** しかないため、サーバサイドで以下を強制する。

| レイヤ | 対策 |
|--------|------|
| DB (`login_attempts`) | 試行を全件記録、RPC で直近失敗回数を判定 |
| RPC `fn_check_login_allowed` | 直近15分で5回失敗 → 一時ロック / 24時間20回 → 強制ロック |
| RLS | `login_attempts` への insert は authenticated/anon 両方許可するが select は admin のみ |
| CAPTCHA（将来） | 失敗が閾値を超えたら Cloudflare Turnstile 等を差し込む |
| 管理機能 | `/users` 画面から admin がロック解除 / PIN リセット |

```sql
create or replace function fn_check_login_allowed(emp text)
returns jsonb language plpgsql security definer as $$
declare
  p profiles%rowtype;
  recent_fail int;
begin
  select * into p from profiles where employee_number = emp;
  if p.is_locked then
    return jsonb_build_object('ok', false, 'message','アカウントロック中');
  end if;
  if p.locked_until is not null and p.locked_until > now() then
    return jsonb_build_object('ok', false,
      'message', format('あと%s秒ロック中', extract(epoch from (p.locked_until - now()))::int));
  end if;
  return jsonb_build_object('ok', true);
end; $$;
```

### 4.1.2 パスワード変更
- 本人が `/settings` から現パスワード + 新パスワードで変更可能
- 新パスワードも 5 桁数字のみ許可
- よく使われる脆弱PIN（`00000`, `12345`, `11111` 等）は拒否リストで弾く

### 4.1.3 セキュリティ上の注意（設計判断の記録）
- 5桁 PIN は一般的な Web アプリとしては脆弱だが、**倉庫内端末での素早い入力性を優先**
  した業務要件上の判断である
- レート制限 + ロック + 監査ログの 3 点セットで運用的に担保する
- 将来的に **ICカード認証** や **TOTP 2FA** の追加を選択肢として残す（P5 以降）

### 4.2 プロフィール & ロール
- `auth.users` 作成時、admin が明示的に `profiles` を同じトランザクションで作成する
  （擬似メールから社員番号を切り出してセット）
- `profiles.role` のデフォルトは `viewer`
- admin が UI からロールを変更（`/users` 画面）

```sql
-- admin が UI からユーザー発行する際に使うヘルパ
create or replace function fn_admin_create_user(
  emp text, display text, role_in text, initial_pin text
) returns uuid language plpgsql security definer as $$
declare
  new_id uuid;
begin
  -- 呼び出し元が admin か確認
  if not exists (select 1 from profiles p where p.id=auth.uid() and p.role='admin') then
    raise exception 'forbidden';
  end if;
  if initial_pin !~ '^\d{5}$' then
    raise exception 'PIN must be 5 digits';
  end if;
  -- auth.admin は Edge Function 側で実行する想定。ここでは profiles のみ
  insert into profiles(id, employee_number, display_name, role)
  values (gen_random_uuid(), emp, display, role_in)
  returning id into new_id;
  return new_id;
end; $$;
```

> 注: `auth.users` への INSERT は PostgREST から直接できないため、実運用では
> **Supabase Edge Function**（Service Role Key 使用）から `auth.admin.createUser` を
> 呼び出し、続けて上記 `fn_admin_create_user` を実行する。

### 4.3 権限マトリクス（詳細）

| 機能 | admin | operator | viewer |
|------|:-----:|:--------:|:------:|
| ログイン | ✅ | ✅ | ✅ |
| ダッシュボード閲覧 | ✅ | ✅ | ✅ |
| 商品マスタ 閲覧 | ✅ | ✅ | ✅ |
| 商品マスタ 編集 | ✅ | ❌ | ❌ |
| ロケーション 閲覧 | ✅ | ✅ | ✅ |
| ロケーション 編集 | ✅ | ❌ | ❌ |
| 入庫 登録/検品/完了 | ✅ | ✅ | ❌ |
| 入庫 閲覧 | ✅ | ✅ | ✅ |
| 出庫 登録/ピック/完了 | ✅ | ✅ | ❌ |
| 出庫 閲覧 | ✅ | ✅ | ✅ |
| ロケーション移動 | ✅ | ✅ | ❌ |
| 棚卸 指示作成 | ✅ | ❌ | ❌ |
| 棚卸 カウント入力 | ✅ | ✅ | ❌ |
| 棚卸 確定 | ✅ | ❌ | ❌ |
| CSV エクスポート | ✅ | ✅ | ✅ |
| レポート画面 | ✅ | ❌ | ❌ |
| ユーザー管理 | ✅ | ❌ | ❌ |

### 4.4 RLS ポリシー例
```sql
-- products 編集は admin のみ
create policy products_admin_write on products
  for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role='admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role='admin'));

-- products 閲覧は全ロール
create policy products_auth_read on products
  for select
  using (auth.role() = 'authenticated');
```

## 5. サーバサイド RPC（PostgreSQL 関数）

フロントから複数 SQL を順に発行すると中途半端な状態が生まれるため、
**在庫を増減する処理は必ず RPC 経由**で呼び出す。

| 関数名 | 目的 | 引数（主なもの）|
|--------|------|----------------|
| `fn_inbound_putaway(item_id uuid, location_id uuid, qty int)` | 棚入れと在庫加算 | — |
| `fn_outbound_pick(item_id uuid, from_location uuid, lot text, qty int)` | 引当と在庫減算 | — |
| `fn_inventory_move(from_inv uuid, to_loc uuid, qty int)` | ロケーション移動 | — |
| `fn_stocktake_snapshot(stocktake_id uuid)` | スナップショット生成 | — |
| `fn_stocktake_confirm(stocktake_id uuid)` | 差異反映と確定 | admin のみ |

これらは `security definer` + 関数先頭で `auth.uid()` のロールをチェックする。

## 6. トランザクション・冪等性

- すべての在庫変動 RPC は 1 トランザクション内で完結させる
- `inventory_movements` は **追加のみ・更新削除なし**（監査ログ）
- クライアントからの再送を想定し、入庫完了・出庫完了などは
  同一 `ref_type + ref_id` 組み合わせで UNIQUE 制約を設け冪等化する
  （例: `inventory_movements` に `(ref_type, ref_id, type) unique` の部分インデックス）

## 7. リアルタイム通知

Supabase Realtime（`postgres_changes`）を利用して:
- ダッシュボード KPI をライブ更新
- 他オペレータの入出庫完了を一覧に即反映
- 棚卸カウント画面で同じロケを同時編集されたら警告

```js
supabase.channel('inv')
  .on('postgres_changes', { event:'*', schema:'public', table:'inventory' }, onChange)
  .subscribe();
```

## 8. 監査とログ

- DB 側: `inventory_movements` がそのまま監査ログ
- アプリ側: 重要操作（ログイン、ロール変更、棚卸確定）は将来
  `audit_log` テーブルに追加する（P4 フェーズ）

## 9. CI / 開発フロー

| ステップ | ツール |
|----------|--------|
| Lint | ESLint（TS 化後）/ Prettier |
| DB マイグレーション | `supabase db push`（ローカル→リモート）|
| プレビュー | Vercel preview deploy |
| 本番反映 | `main` マージで自動デプロイ |

ブランチ運用:
- `main` … 本番相当
- `claude/*` … 作業ブランチ（本プロジェクトでは `claude/build-wms-7zTLC`）
- PR 経由で `main` へマージ

## 10. リスクと対応

| リスク | 対応 |
|--------|------|
| 在庫不整合 | RPC で全変動をトランザクション化、`inventory_movements` で再計算検証可能にする |
| 同時編集 | 棚卸中ロケ ロック + Realtime 通知 |
| オフライン現場 | P5 で PWA 化し、スキャン結果を IndexedDB にキュー |
| 匿名 API Key 漏洩 | 匿名キーは SELECT のみ許可、書き込みは RLS + ログイン必須 |
| 大量データ | ビュー + 適切な index、必要なら pg_partman で履歴分割 |
| **5桁PINブルートフォース** | `login_attempts` によるレート制限 + 一時/強制ロック、将来的に CAPTCHA / 2FA |
| **退職者アカウント残存** | admin 画面からロール `viewer` 化 or `is_locked=true`、削除ではなく論理無効化 |

## 11. 次アクション（実装着手に向けて）

1. Supabase プロジェクト新規作成 or 既存プロジェクトの再利用可否判断
2. `supabase/migrations/0001_init.sql` に 02 章の DDL を落とし込む
3. 初回 admin ユーザーの作成と RLS ポリシー適用
4. `wms_supabase.html` からクライアント管理を外し、棚卸・ロケーション移動画面の追加に着手
