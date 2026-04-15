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

### 4.1 Supabase Auth
- プロバイダ: メール + パスワード（招待制）
- セッションは localStorage に保存（Supabase JS SDK デフォルト）
- サインアップは **管理者が招待メール経由**で発行。オープン登録は無効化

### 4.2 プロフィール & ロール
- `auth.users` 作成時のトリガで `profiles` に空レコードを作成
- `profiles.role` のデフォルトは `viewer`
- admin が UI からロールを変更（`/users` 画面）

```sql
-- 初回プロフィール自動作成トリガ
create function public.handle_new_user() returns trigger
language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'viewer')
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

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

## 11. 次アクション（実装着手に向けて）

1. Supabase プロジェクト新規作成 or 既存プロジェクトの再利用可否判断
2. `supabase/migrations/0001_init.sql` に 02 章の DDL を落とし込む
3. 初回 admin ユーザーの作成と RLS ポリシー適用
4. `wms_supabase.html` からクライアント管理を外し、棚卸・ロケーション移動画面の追加に着手
