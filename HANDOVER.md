# SUPEREX LogiStation — 引継ぎ書

作成日: 2026-07-17  
引継ぎ元セッション: https://claude.ai/code/session_012HgZd48p5Emukadt9ebD27

---

## 1. プロジェクト概要

| 項目 | 内容 |
|------|------|
| アプリ名 | SUPEREX LogiStation |
| 種別 | WMS（倉庫管理システム） |
| 構成 | 単一HTMLファイル + バニラJS（フレームワークなし） |
| バックエンド | Supabase（PostgreSQL + Auth + RLS + RPC） |
| ホスティング | GitHub Pages（`gh-pages` ブランチ） |
| リポジトリ | `katsu-nari/wms` |
| 開発ブランチ | `claude/build-wms-7zTLC` |

---

## 2. Supabase 接続情報

```
URL : https://fpobnehdqamuqlepfkrf.supabase.co
ANON KEY : eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwb2JuZWhkcWFtdXFsZXBma3JmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTEzMDIsImV4cCI6MjA5MDc4NzMwMn0._Io2LvqCrqe3ZTmQgNpInu_iNAaCqK8Hn-Xp5Ijsnd8
```

設定箇所: `js/app.js` 冒頭 `SB_URL` / `SB_KEY`

---

## 3. ファイル構成

```
/
├── index.html                  # エントリポイント（全CSS・HTML骨格・script読込）
├── js/
│   ├── app.js                  # Supabase初期化・認証・ナビゲーション・共通ユーティリティ
│   ├── dashboard.js            # ダッシュボード
│   ├── products.js             # 商品マスタ
│   ├── locations.js            # ロケーション管理（P6）
│   ├── inventory.js            # 在庫一覧
│   ├── inbound.js              # 入庫処理（手動）
│   ├── inbound-plan.js         # 入荷予定管理（Excel取込・PDF）
│   ├── inbound-plan-detail.js  # 入荷予定詳細（PC検品・QR検品・入荷計上）
│   ├── outbound.js             # 出庫処理
│   ├── move.js                 # ロケーション移動
│   ├── stocktake.js            # 棚卸管理（P7） + レポート + ユーザー管理
│   ├── suppliers.js            # 仕入先マスタ
│   ├── clients.js              # 荷主マスタ
│   └── scan.js                 # スキャン（ライブカメラ）
└── supabase/migrations/
    ├── 0001_schema.sql         # 基本テーブル（inventory, products, locations等）
    ├── 0002_rls.sql            # RLSポリシー基盤
    ├── 0003_functions.sql      # 共通RPC（fn_inventory_upsert等）
    ├── 0004_suppliers_and_prices.sql
    ├── 0005_update_inventory_view.sql  # v_inventory_with_names
    ├── 0006_clients.sql
    ├── 0007_location_map.sql   # ロケーションマップ用ビュー
    ├── 0008_inbound_plans.sql  # 入荷予定テーブル
    ├── 0009_plan_no_rpc.sql    # 採番RPC
    ├── 0010_p4_stabilize.sql
    ├── 0011_p4_3_atomic.sql    # fn_create_inbound_plan
    ├── 0012_template_simplify.sql
    ├── 0013_validate_items_v2.sql  # fn_validate_inbound_items
    ├── 0014_p5_inspection_flow.sql # fn_ip_start_receiving / fn_ip_scan_item / fn_ip_confirm / fn_ip_cancel
    ├── 0015_p6_location_mgmt.sql   # v_inventory_by_location, v_location_summary
    ├── 0016_p7_stocktake.sql       # inventory_counts / fn_start_inventory_count等
    └── 0017_p5_5_pc_inspection.sql # PC検品・fn_receive_inbound_plan・inbound_receiving_logs
```

---

## 4. 主要テーブル一覧

| テーブル | 用途 |
|---------|------|
| `profiles` | ユーザープロフィール（role: admin/operator/viewer） |
| `products` | 商品マスタ（jan_code, sku, case_qty等） |
| `locations` | ロケーションマスタ（code, zone, aisle, rack, level, bin） |
| `inventory` | 在庫（product_id, location_id, lot_no, expiry, qty） |
| `inbound_plans` | 入荷予定ヘッダ |
| `inbound_plan_items` | 入荷予定明細（checked, received_qty等） |
| `inbound_scan_logs` | QRスキャン検品ログ |
| `inbound_receiving_logs` | 入荷計上監査ログ（P5.5） |
| `outbound_orders` | 出庫オーダー |
| `inventory_counts` | 棚卸ヘッダ（P7） |
| `inventory_count_items` | 棚卸明細（P7） |
| `inventory_adjustments` | 棚卸差異履歴（P7） |
| `suppliers` | 仕入先マスタ |
| `clients` | 荷主マスタ |
| `document_sequences` | 採番テーブル（IP-, IC-等のプレフィックスごと） |

**主要ビュー**:
- `v_inventory_with_names` — 在庫+商品名+ロケーションコード結合
- `v_inventory_by_location` — ロケーション別在庫集計（商品名検索用）
- `v_location_summary` — ロケーション一覧+利用状況集計

---

## 5. 主要RPC一覧

| 関数名 | 用途 |
|-------|------|
| `fn_inventory_upsert(product, location, lot, expiry, delta)` | 在庫加減算（共通） |
| `fn_create_inbound_plan(planned_date, client_id, items)` | 入荷予定登録（atomic） |
| `fn_validate_inbound_items(items)` | Excel取込時JAN照合 |
| `fn_ip_start_receiving(plan_id)` | 検品開始（planned→receiving） |
| `fn_ip_scan_item(plan_id, jan_code, qty, scan_type)` | QRスキャン検品 |
| `fn_ip_confirm(plan_id, location_id, variances)` | 旧・入庫確定RPC（互換用） |
| `fn_ip_cancel(plan_id, reason)` | 入荷予定キャンセル |
| `fn_receive_inbound_plan(plan_id, location_id, items)` | PC検品→入荷計上（atomic・P5.5） |
| `fn_start_inventory_count(count_type, location_id, product_id)` | 棚卸開始（P7） |
| `fn_scan_inventory_count(count_id, jan_code, qty)` | 棚卸スキャン（P7） |
| `fn_complete_inventory_count(count_id)` | 棚卸確定+在庫補正（P7） |
| `fn_check_login_allowed(emp)` | ログイン前チェック |
| `fn_record_login_attempt(emp, ok)` | ログイン試行ログ |

---

## 6. 実装済み機能（フェーズ別）

| フェーズ | 機能 | ステータス |
|---------|------|-----------|
| P1–P3 | 商品・在庫・ロケーション基盤・認証 | 完了 |
| P4 | 入荷予定Excel取込・採番・検品リストPDF | 完了 |
| P5 | QRスキャン検品・入庫確定フロー | 完了 |
| P5.5 | PC検品（チェックボックス方式）・入荷計上RPC | 完了 |
| P6 | ロケーション管理強化（詳細・KPI・QR・商品検索） | 完了 |
| P7 | 棚卸管理（ロケーション/商品棚卸・差異管理・在庫補正） | 完了 |

---

## 7. 開発上の重要な設計決定

### ナビゲーション
- `go('page-name')` で画面遷移
- `RENDER_FNS['page-name'] = async function()` でページレンダリング登録
- `PAGE_TITLES` に表示名を登録（`app.js`）
- `index.html` に `<div class="page" id="page-xxx"></div>` を追加

### 権限制御
```js
isAdmin()     // role === 'admin'
isOperator()  // role === 'admin' || role === 'operator'
```
RLS側: `fn_is_operator_or_admin()` / `fn_is_admin()`

### QR/バーコード
- `_generateQrDataUrl(text)` — `inbound-plan.js` で定義、全ファイルから呼び出し可能
- QRコンテンツ形式: `{"type":"location","location_code":"A-01-01"}` / `{"type":"inbound_plan","plan_no":"IP...","version":1}`
- スキャン処理: `scan.js` の `_handleStructuredQr()` でtypeごとにルーティング

### 在庫更新ルール
- 必ず `fn_inventory_upsert` を経由（直接INSERTしない）
- `inventory` テーブルのユニーク制約: `(product_id, location_id, lot_no, coalesce(expiry_date,'1900-01-01'))`

### CDNライブラリ（index.html読込順）
```
html5-qrcode@2.3.8  → Html5Qrcode
supabase-js@2       → supabase
xlsx@0.18.5         → XLSX
jspdf@2.5.1         → jspdf
html2canvas@1.4.1   → html2canvas
jsbarcode@3.11.6    → JsBarcode
qrcode-generator@1.4.4 → qrcode
```

---

## 8. 開発バイパス設定

`js/app.js` 末尾の `DEV_SKIP_LOGIN` フラグ:

```js
const DEV_SKIP_LOGIN = true;   // ← true: ログイン画面スキップ（DEV User / admin権限）
                                //   false: 通常のログイン画面を表示
```

**注意**: `DEV_SKIP_LOGIN = true` のままだとSupabaseに未認証のためDB操作はRLSで弾かれる。UIの確認のみ可能。**本番デプロイ前に必ず `false` に戻すこと。**

---

## 9. デプロイ手順

```bash
# 1. 開発ブランチへコミット
git add .
git commit -m "feat: ..."
git push -u origin claude/build-wms-7zTLC

# 2. mainブランチへマージ
git checkout main
git merge claude/build-wms-7zTLC
git push origin main

# 3. gh-pagesへデプロイ（GitHub Pagesソース）
git checkout gh-pages
git merge main
git push origin gh-pages
git checkout claude/build-wms-7zTLC  # 開発ブランチへ戻る
```

Supabaseマイグレーション（`supabase/migrations/`のSQLファイル）はSupabase DashboardのSQL Editorで手動実行。

---

## 10. 未着手・今後の候補タスク

以下は実装されていない（明示的にスコープ外とした）項目:

- 配送管理 / 配車
- ASN（事前出荷通知）
- CSV取込 / EDI連携
- 発注管理
- 差異承認フロー（フル実装）
- 入庫実績との自動連携
- 出庫ピッキング高度化（ウェーブ・バッチ）

---

## 11. 新アカウントでの再開手順

1. GitHubリポジトリ `katsu-nari/wms` にアクセス権を付与
2. Claude Code の新セッションでリポジトリを clone / add
3. 作業ブランチ `claude/build-wms-7zTLC` をチェックアウト
4. 本ファイル（`HANDOVER.md`）を最初に読み込ませる
5. 続きの指示を出す
