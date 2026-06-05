# P1 クライアント（荷主）管理画面 設計書

**対象**: `index.html` + `js/` 配下  
**作成日**: 2026-06-05  
**ステータス**: レビュー待ち（未実装）

---

## 1. 新規テーブルの有無

### 結論: **新規テーブル1つ追加**

`clients` テーブルを新規作成する。

既存の `suppliers`（仕入先）テーブルと対になる構造で、仕入先が「入庫元」であるのに対し、クライアントは「荷主＝出庫先」に該当する。

---

## 2. clients テーブル定義

### 設計方針

既存の `suppliers` テーブル（0004_suppliers_and_prices.sql）と構造を揃える。  
suppliers のパターンを踏襲し、address カラムを追加する。

### テーブル定義

```sql
create table if not exists clients (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,           -- 荷主コード（例: CL001）
  name         text not null,                  -- 荷主名（例: 株式会社ABC商事）
  contact      text,                           -- 担当者名
  phone        text,                           -- 電話番号
  email        text,                           -- メールアドレス
  address      text,                           -- 住所
  is_active    bool not null default true,     -- 有効/無効
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_clients_code on clients (code);
```

### suppliers テーブルとの比較

| カラム | suppliers | clients（新規） | 差分 |
|--------|----------|----------------|------|
| id | ✓ uuid PK | ✓ uuid PK | 同一 |
| code | ✓ unique | ✓ unique | 同一 |
| name | ✓ | ✓ | 同一 |
| contact | ✓ | ✓ | 同一 |
| phone | ✓ | ✓ | 同一 |
| email | ✓ | ✓ | 同一 |
| address | ✗ | ✓ | **追加** |
| is_active | ✓ | ✓ | 同一 |
| created_at | ✓ | ✓ | 同一 |
| updated_at | ✓ | ✓ | 同一 |

### 付随オブジェクト

```sql
-- updated_at トリガ（fn_set_updated_at は 0001_schema.sql で定義済み）
drop trigger if exists trg_clients_upd on clients;
create trigger trg_clients_upd before update on clients
  for each row execute function fn_set_updated_at();

-- RLS（suppliers と同じパターン）
alter table clients enable row level security;

drop policy if exists clients_read on clients;
create policy clients_read on clients
  for select using (fn_is_authenticated_user());

drop policy if exists clients_admin_write on clients;
create policy clients_admin_write on clients
  for all using (fn_is_admin()) with check (fn_is_admin());
```

---

## 3. 既存テーブルとの関連

### 現状の荷主情報

| テーブル | カラム | 型 | 現状 |
|---------|--------|-----|------|
| outbound_orders | `customer` | text | 自由入力テキスト。荷主名を直接格納 |
| inbound_orders | `supplier` | text | 仕入先名テキスト（`supplier_id` FK も 0004 で追加済み） |
| products | — | — | 荷主紐付けなし |
| inventory | — | — | 荷主紐付けなし |

### 紐付け方針

#### outbound_orders への FK 追加

```sql
alter table outbound_orders
  add column if not exists client_id uuid references clients(id);
```

- 既存の `customer` text カラムは**削除しない**（既存データ保全）
- 新規登録時は `client_id` を使用
- 一覧表示は `client_id → clients.name` を優先、なければ `customer` テキストにフォールバック

#### inbound_orders — 変更不要

入庫は仕入先（suppliers）が主体。荷主（clients）との直接紐付けは不要。

#### products — 変更不要（Phase 1 対象外）

将来的に荷主別商品管理が必要になった場合は `products` に `client_id` FK を追加する。  
P1 段階では荷主マスタの CRUD のみを実装し、products への紐付けは見送る。

#### inventory — 変更不要

inventory は product_id + location_id でスロット管理しており、荷主はproducts 経由で間接参照する設計。

### 関連図

```
clients (新規)
  │
  ├── outbound_orders.client_id (FK, NULL許可)
  │     └── 既存 customer text は残す（フォールバック用）
  │
  └── (将来) products.client_id
              └── inventory → product_id → products → client_id

suppliers (既存)
  │
  └── inbound_orders.supplier_id (FK, 0004で追加済み)
        └── 既存 supplier text も残っている
```

---

## 4. 既存データ移行方法

### 移行対象

outbound_orders の `customer` text カラムに格納されている荷主名を clients テーブルに変換する。

### 移行手順

```sql
-- Step 1: customer カラムのユニーク値を clients に一括登録
INSERT INTO clients (code, name)
SELECT
  'CL' || LPAD(ROW_NUMBER() OVER (ORDER BY customer)::text, 3, '0'),
  customer
FROM (SELECT DISTINCT customer FROM outbound_orders WHERE customer IS NOT NULL) sub
ON CONFLICT (code) DO NOTHING;

-- Step 2: outbound_orders.client_id を紐付け
UPDATE outbound_orders o
SET client_id = c.id
FROM clients c
WHERE o.customer = c.name
  AND o.client_id IS NULL;
```

### 移行リスク

| リスク | 影響度 | 対策 |
|--------|--------|------|
| customer テキストの表記揺れ（例: 「ABC商事」vs「株式会社ABC商事」） | 中 | 移行前に `SELECT DISTINCT customer` で確認。手動で名寄せ |
| outbound_orders に customer が NULL のレコード | なし | client_id も NULL のまま（FK は NULL 許可） |
| 移行 SQL 実行後にロールバックが必要 | 低 | client_id を NULL に戻すだけで復旧可能 |

### 移行タイミング

- migration ファイルに移行 SQL は**含めない**
- clients テーブル作成後、管理者が Dashboard の SQL エディタで手動実行する
- 一括移行が不要な場合は、新規出庫登録時に clients マスタから選択する運用に切り替えるだけでも可

---

## 5. 画面構成

### ナビゲーション配置

サイドバーの「MASTER」セクションに追加（仕入先マスタの下）:

```
MASTER
  商品マスタ
  ロケーション
  仕入先マスタ
  荷主マスタ    ← 新規追加
```

### 5-1. 一覧画面

```
┌─────────────────────────────────────────────────────┐
│ [検索バー: コード/荷主名で検索]     [+ 荷主追加]      │
├─────────────────────────────────────────────────────┤
│ コード │ 荷主名    │ 担当者 │ 電話   │ メール │ 状態 │ 操作 │
│ CL001  │ ABC商事   │ 山田   │ 03-... │ a@b.c  │ 有効 │ [編集]│
│ CL002  │ XYZ物流   │ 佐藤   │ 06-... │ x@y.z  │ 有効 │ [編集]│
│ CL003  │ 旧取引先  │ —      │ —      │ —      │ 無効 │ [編集]│
└─────────────────────────────────────────────────────┘
```

- テーブル形式（suppliers.js と同一パターン）
- テキスト検索: code + name でフィルタ
- 状態バッジ: 有効=緑 / 無効=グレー

### 5-2. 新規登録モーダル

```
┌─────────────────────────────┐
│ 荷主追加                  × │
├─────────────────────────────┤
│ 荷主コード *  [CL004     ]  │
│ 荷主名 *      [△△株式会社]  │
│ 担当者名      [田中 太郎 ]  │
│ 電話番号      [03-0000-00]  │
│ メール        [a@example ]  │
│ 住所          [東京都... ]  │
├─────────────────────────────┤
│           [キャンセル] [登録]│
└─────────────────────────────┘
```

- suppliers.js の `openSupplierModal()` と同一パターン
- code は必須ユニーク制約
- name は必須

### 5-3. 編集モーダル

- 新規登録と同一フォーム
- タイトルが「荷主編集」に変わる
- 既存値がプリフィル

### 5-4. 無効化

- 物理削除は行わない
- `is_active` を false に更新
- 一覧では「無効」バッジ表示
- admin のみ操作可能（編集モーダル内に「無効化」ボタンを配置）

---

## 6. ロール別権限

| 操作 | admin | operator | viewer |
|------|-------|----------|--------|
| 一覧閲覧 | ✓ | ✓ | ✓ |
| 検索 | ✓ | ✓ | ✓ |
| 新規登録 | ✓ | ✗ | ✗ |
| 編集 | ✓ | ✗ | ✗ |
| 無効化 | ✓ | ✗ | ✗ |

### 実装方法

- `isAdmin()` で「荷主追加」ボタンと「編集」ボタンの表示を制御
- DB レベルでは RLS の `clients_admin_write` ポリシーで admin のみ書き込みを許可
- suppliers.js と完全に同じ権限パターン

---

## 7. CSV 取込対応の有無

### 結論: P1 では CSV 取込は実装しない

| 理由 |
|------|
| 荷主マスタは登録頻度が低い（月に数件程度） |
| 初期移行は SQL スクリプトで対応可能 |
| CSV 取込機能は汎用的に設計すべきで、P1 の範囲を超える |

### CSV エクスポート

- レポート画面（stocktake.js 内の RENDER_FNS.reports）に「荷主マスタ」エクスポートカードを追加する
- 既存の `downloadCSV()` 関数を利用

---

## 8. 将来の荷主管理拡張への影響

### P1 の設計が将来拡張に与える影響

| 将来機能 | P1 設計の対応 | 追加作業 |
|---------|-------------|---------|
| **荷主別在庫管理** | products に `client_id` FK を追加すれば対応可能。P1 の clients テーブルはそのまま利用可 | products に ALTER TABLE + UI 変更 |
| **荷主別ロケーション割当** | locations に `client_id` FK を追加するか、中間テーブルで対応 | テーブル追加 + locations.js 変更 |
| **荷主別料金計算** | clients に `billing_type` / `rate_table_id` 等を追加 | ALTER TABLE + 新規画面 |
| **荷主ポータル** | viewer ロールのユーザーに client_id を紐付け、RLS で自分の荷主データのみ参照可能にする | profiles に `client_id` + RLS 変更 |
| **荷主別 KPI ダッシュボード** | outbound_orders.client_id がキーになる。P1 で FK を設定しておけばそのまま集計可能 | dashboard.js に荷主フィルター追加 |

### P1 で守るべき設計原則

1. **clients.id は UUID** — 将来どのテーブルからも FK で参照可能
2. **code はユニーク制約** — 荷主コードで外部システム連携可能
3. **is_active による論理削除** — 物理削除禁止で監査対応
4. **outbound_orders.client_id は NULL 許可** — 既存データを壊さない

---

## 工数

| 作業 | 内容 | 時間 |
|------|------|------|
| SQL マイグレーション作成 | clients テーブル + RLS + outbound_orders に client_id 追加 | 0.5h |
| `js/clients.js` 新規作成 | 一覧・検索・登録・編集・無効化 | 2h |
| `index.html` 変更 | サイドバー・ドロワー・ボトムナビ・page div・script タグ | 0.5h |
| `js/app.js` 変更 | PAGE_TITLES に clients 追加 | 5min |
| `js/outbound.js` 変更 | 出庫登録モーダルに荷主セレクトボックス追加 | 1h |
| `js/stocktake.js` 変更 | レポート画面に荷主マスタCSV追加 | 0.5h |
| テスト | 全画面の動作確認 | 0.5h |
| **合計** | | **約5時間** |

---

## 変更ファイル一覧

| ファイル | 変更種別 | 内容 |
|---------|---------|------|
| `supabase/migrations/0006_clients.sql` | **新規** | clients テーブル + RLS + outbound_orders.client_id |
| `js/clients.js` | **新規** | 荷主マスタ CRUD（~120行） |
| `index.html` | 変更 | ナビ追加 + page-clients div + script タグ |
| `js/app.js` | 変更 | PAGE_TITLES に1行追加 |
| `js/outbound.js` | 変更 | 出庫登録モーダルに荷主選択追加 |
| `js/stocktake.js` | 変更 | レポート画面に荷主マスタCSVカード追加 |

---

## DB 変更一覧

| 種別 | オブジェクト | 内容 |
|------|------------|------|
| CREATE TABLE | `clients` | 荷主マスタ（10カラム） |
| CREATE INDEX | `idx_clients_code` | code カラムのインデックス |
| CREATE TRIGGER | `trg_clients_upd` | updated_at 自動更新 |
| CREATE POLICY | `clients_read` | 全認証ユーザーに SELECT 許可 |
| CREATE POLICY | `clients_admin_write` | admin のみ INSERT/UPDATE/DELETE 許可 |
| ALTER TABLE | `outbound_orders` | `client_id uuid references clients(id)` 追加（NULL許可） |

### 既存テーブルへの影響

| テーブル | 影響 |
|---------|------|
| outbound_orders | `client_id` カラム追加（NULL許可、既存データに影響なし） |
| products | 変更なし |
| inventory | 変更なし |
| inbound_orders | 変更なし |
| suppliers | 変更なし |
| locations | 変更なし |

---

*設計書ここまで。承認後に P1 を実装します。*
