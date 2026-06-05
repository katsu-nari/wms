# P2 ロケーションビジュアルマップ 設計書（v2）

**対象**: `js/locations.js` + `index.html`  
**作成日**: 2026-06-05  
**改訂日**: 2026-06-05（v2: capacity依存廃止、3状態化、コード形式バリデーション追加）  
**ステータス**: レビュー待ち（未実装）

---

## 1. 現状分析

### 1-1. locations テーブル定義

```sql
create table if not exists locations (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,      -- ロケーションコード
  zone              text not null,             -- ゾーン（A, B, C...）
  aisle             text,                      -- 通路番号（01, 02...）
  rack              text,                      -- 棚番号（01, 02...）
  level             text,                      -- 段（1, 2, 3...）
  bin               text,                      -- ビン（A, B...）
  storage_condition text,                      -- ambient/refrigerated/frozen/hazard
  capacity          int,                       -- 容量（単位未定義、現在全件NULL）
  pick_priority     int not null default 100,  -- ピッキング優先度
  is_active         bool not null default true,
  created_at        timestamptz,
  updated_at        timestamptz
);
```

**インデックス**: `idx_locations_path ON (zone, aisle, rack, level, bin)`  
**RLS**: 閲覧=全認証ユーザー / 編集=admin のみ

### 1-2. location_code 命名規則

**正規フォーマット**: `^[A-Z]-\d{2}-\d{2}-\d-[A-Z]$`

```
A-01-01-1-A
│  │  │ │ └── bin（ビン：英大文字1文字）
│  │  │ └──── level（段：数字1桁）
│  │  └────── rack（棚番号：ゼロ埋め2桁）
│  └───────── aisle（通路番号：ゼロ埋め2桁）
└──────────── zone（ゾーン：英大文字1文字）
```

**シードデータ（50件）**: 全件がこのフォーマットに一致。例外なし。  
**現状の問題**: `saveLocation()` にフォーマット検証がない → P2で追加する。

### 1-3. シードデータの実態

| 項目 | 値 |
|------|-----|
| zone の種類 | A, B, C, D, E（5種） |
| aisle の最大値 | 02（2通路/ゾーン） |
| rack の最大値 | 03（3棚/通路、ただし aisle 02 は rack 02 まで） |
| level の最大値 | 2（2段/棚） |
| bin の最大値 | A（1種のみ） |
| capacity | **全50件 NULL**（未使用） |
| 1ゾーンあたり | 10ロケーション |

### 1-4. 現在のロケーション利用状況

| 機能 | テーブル | 使用カラム | 用途 |
|------|---------|-----------|------|
| 在庫管理 | `inventory` | `location_id` | 在庫スロット（SKU×ロット×ロケ×期限で一意） |
| 入庫 | `inbound_items` | `location_id` | 棚入れ先ロケーション |
| 出庫 | `outbound_items` | `from_location_id` | ピッキング元ロケーション |
| 移動 | `inventory_movements` | `location_id` | 移動元/先のログ |
| 棚卸 | `stocktake_items` | `location_id` | カウント対象ロケーション |
| 棚卸スコープ | `stocktakes` | `scope_zone` | ゾーン単位でスナップショット範囲を指定 |

### 1-5. 既存ビュー

`v_inventory_with_names` — inventory + products + locations を結合済み:
- `location_id`, `location_code`, `zone`, `storage_condition` が取得可能
- `qty`, `locked_qty`, `available_qty` で在庫量を把握可能

---

## 2. マップ表示設計

### 2-1. 表示イメージ

```
┌──────────────────────────────────────────────────────────────┐
│ [ゾーン A ▼]     凡例: □空き ■使用中 ▨無効                     │
├──────────────────────────────────────────────────────────────┤
│ 使用率: 60% (6/10) | 空き: 4 | 無効: 0 | 合計: 350個          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│         通路01         通路02                                 │
│       ┌──────┐       ┌──────┐                                │
│       │01-01 │       │02-01 │                                │
│ 棚01  │ 120個│       │  —   │                                │
│       │■■■■■ │       │      │                                │
│       └──────┘       └──────┘                                │
│       ┌──────┐       ┌──────┐                                │
│       │01-02 │       │02-02 │                                │
│ 棚02  │  80個│       │  50個│                                │
│       │■■■■■ │       │■■■■■ │                                │
│       └──────┘       └──────┘                                │
│       ┌──────┐                                               │
│       │01-03 │                                               │
│ 棚03  │ 100個│                                               │
│       │■■■■■ │                                               │
│       └──────┘                                               │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 2-2. グリッド座標マッピング

locations テーブルの5階層を2次元グリッドに変換する:

| 軸 | マッピング元 | 説明 |
|----|------------|------|
| X軸（列） | `aisle`（通路） | 左から右へ通路番号順 |
| Y軸（行） | `rack`（棚） | 上から下へ棚番号順 |
| セル集約 | `level` × `bin` | 同一 aisle-rack の全 level/bin を合算してセルに表示 |

**ゾーン選択**: ドロップダウンでゾーンを切替え。1画面に1ゾーンを表示。

### 2-3. セル色分けルール（3状態）

| 状態 | 色 | 条件 |
|------|-----|------|
| 空き | `--surface2`（薄グレー） | `total_qty = 0` かつ `is_active = true` |
| 使用中 | `--accent-light`（薄青）+ 左ボーダー `--accent`（青） | `total_qty > 0` かつ `is_active = true` |
| 無効 | `--border`（グレー）+ 斜線パターン | `is_active = false` |

**capacity依存の色分けは実装しない**（全件NULL のため）。  
将来 capacity が運用される場合は、使用中を密度別に細分化する拡張を行う。

### 2-4. セル内表示

```
┌─────────┐
│ 01-02   │  ← aisle-rack
│ 80個    │  ← total_qty（0の場合は「空き」）
│ 2 SKU   │  ← product_count
└─────────┘
```

- 空きセル: aisle-rack のみ表示、数値なし
- 無効セル: aisle-rack + 「無効」ラベル、グレーアウト

### 2-5. セルクリック時の詳細表示

セルクリックでモーダルにそのロケーションの在庫明細を表示:

```
┌────────────────────────────────────┐
│ A-01-02 の在庫                    × │
├────────────────────────────────────┤
│ 商品名          │ ロット │ 数量    │
│ ミネラルウォーター │ L001   │ 50     │
│ 緑茶ペットボトル   │ L002   │ 30     │
├────────────────────────────────────┤
│ 合計: 80個                         │
└────────────────────────────────────┘
```

**取得方法**:
```js
const { data } = await sb.from('v_inventory_with_names')
  .select('product_name, lot_no, qty')
  .eq('location_id', clickedLocationId)
  .gt('qty', 0);
```

既存ビュー `v_inventory_with_names` を利用するため、新規クエリの追加不要。

### 2-6. サマリーバー

マップ上部にゾーン全体のKPIを表示:

```
使用率: 60% (6/10) | 空き: 4 | 無効: 0 | 合計在庫: 350個
```

JS側で `v_location_summary` の結果から算出:
```js
const total = data.length;
const used = data.filter(d => d.total_qty > 0 && d.is_active).length;
const empty = data.filter(d => d.total_qty === 0 && d.is_active).length;
const inactive = data.filter(d => !d.is_active).length;
const totalQty = data.reduce((s, d) => s + d.total_qty, 0);
```

---

## 3. 実装方式

### 採用: B案（集計ビュー追加）

**方式**: `v_location_summary` ビューでDB側集計。

**理由**:
1. 集計ロジックがDBに集約され一貫性が高い
2. `v_inventory_with_names` と同様のパターンで既存設計と一貫
3. ゾーン絞り込みで `idx_locations_path` インデックスが活用される
4. 将来のダッシュボード連携にも転用可能

---

## 4. v_location_summary ビュー定義

```sql
CREATE OR REPLACE VIEW v_location_summary AS
SELECT
  l.id,
  l.code,
  l.zone,
  l.aisle,
  l.rack,
  l.level,
  l.bin,
  l.is_active,
  COALESCE(SUM(i.qty), 0)::int AS total_qty,
  COUNT(DISTINCT i.product_id) FILTER (WHERE i.qty > 0)::int AS product_count
FROM locations l
LEFT JOIN inventory i ON i.location_id = l.id AND i.qty > 0
GROUP BY l.id;
```

**v1 からの変更点**:
- `capacity`, `storage_condition`, `pick_priority` を除外（マップで不使用）
- `fill_pct` を除外（capacity 全件 NULL のため意味がない）
- `locked_qty` を除外（マップでは表示しない）
- `FILTER (WHERE i.qty > 0)` で qty=0 の在庫行を product_count から除外

### サンプル出力

```
id     | code        | zone | aisle | rack | level | bin | is_active | total_qty | product_count
-------+-------------+------+-------+------+-------+-----+-----------+-----------+--------------
(uuid) | A-01-01-1-A | A    | 01    | 01   | 1     | A   | true      | 120       | 2
(uuid) | A-01-01-2-A | A    | 01    | 01   | 2     | A   | true      | 0         | 0
(uuid) | A-01-02-1-A | A    | 01    | 02   | 1     | A   | true      | 80        | 2
(uuid) | A-02-01-1-A | A    | 02    | 01   | 1     | A   | false     | 0         | 0
```

---

## 5. 画面構成

### 5-1. レイアウト変更

既存のロケーション画面にタブを追加:

```
[一覧] [マップ]    ← タブ切替

※マップタブ選択時にのみデータ取得・マップ描画
※一覧タブは既存のCRUDテーブル（変更なし）
```

### 5-2. マップタブ内構成

```
┌────────────────────────────────────────────────────────┐
│ タブ: [一覧] [マップ]                                    │
├────────────────────────────────────────────────────────┤
│                                                        │
│ ┌─ フィルター + 凡例 ────────────────────────────────┐  │
│ │ [ゾーン ▼]     □空き  ■使用中  ▨無効              │  │
│ └──────────────────────────────────────────────────┘  │
│                                                        │
│ ┌─ サマリー ─────────────────────────────────────────┐  │
│ │ 使用率: 60% (6/10) | 空き: 4 | 無効: 0 | 計: 350個 │  │
│ └──────────────────────────────────────────────────┘  │
│                                                        │
│ ┌─ グリッド ─────────────────────────────────────────┐  │
│ │       通路01    通路02                              │  │
│ │ 棚01  [■ 120個] [□ 空き ]                          │  │
│ │ 棚02  [■  80個] [■  50個]                          │  │
│ │ 棚03  [■ 100個]                                    │  │
│ └──────────────────────────────────────────────────┘  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 6. location_code 形式バリデーション

### 追加箇所: `saveLocation()` in `locations.js`

```js
const codeRegex = /^[A-Z]-\d{2}-\d{2}-\d-[A-Z]$/;
if (!codeRegex.test(d.code)) {
  toast('コード形式が不正です（例: A-01-01-1-A）', 'error');
  return;
}
```

### バリデーション仕様

| 項目 | ルール | 例 |
|------|--------|-----|
| zone | 英大文字1文字 | A, B, C |
| aisle | 数字2桁（ゼロ埋め） | 01, 02, 10 |
| rack | 数字2桁（ゼロ埋め） | 01, 02, 03 |
| level | 数字1桁 | 1, 2, 3 |
| bin | 英大文字1文字 | A, B, C |
| 区切り | ハイフン `-` | — |

### code と各カラムの整合性チェック

code 入力時に zone, aisle, rack, level, bin を自動分解する処理も追加:

```js
// 新規登録時のみ（編集時は code readonly のため不要）
if (!id) {
  const parts = d.code.split('-');
  d.zone  = parts[0];
  d.aisle = parts[1];
  d.rack  = parts[2];
  d.level = parts[3];
  d.bin   = parts[4];
}
```

これにより code と zone/aisle/rack/level/bin の不整合を防止する。

---

## 7. ロール別権限

| 操作 | admin | operator | viewer |
|------|-------|----------|--------|
| マップ閲覧 | ○ | ○ | ○ |
| セルクリック詳細 | ○ | ○ | ○ |
| ゾーンフィルタ | ○ | ○ | ○ |
| ロケーション追加/編集 | ○ | × | × |

マップは読み取り専用。全ロールで閲覧可能。

---

## 8. 性能評価

| ロケーション数 | 評価 |
|--------------|------|
| 50（現在） | 問題なし |
| 100〜500 | 問題なし |
| 1,000 | 問題なし（ゾーン絞り込みで100セル以内） |
| 5,000 | ゾーン絞り込み必須だが問題なし |

**最適化**: `.eq('zone', selectedZone)` でゾーン単位取得。`idx_locations_path` が効く。

---

## 9. 変更ファイル一覧

| ファイル | 変更種別 | 内容 |
|---------|---------|------|
| `supabase/migrations/0007_location_summary_view.sql` | **新規** | `v_location_summary` ビュー作成 |
| `js/locations.js` | 変更 | タブ切替 + マップ描画 + セル詳細 + KPI + コード形式バリデーション（〜130行追加） |
| `index.html` | 変更 | マップ用CSS追加（〜20行） |

---

## 10. DB変更一覧

| 種別 | オブジェクト | 内容 |
|------|------------|------|
| CREATE VIEW | `v_location_summary` | ロケーション別在庫集計ビュー（10カラム） |

**既存テーブルへの影響**: なし  
**既存ビューへの影響**: なし  
**新規テーブル**: なし  
**RLS**: ビューは基テーブル（locations, inventory）のRLSを継承

---

## 11. 工数見積

| 作業 | 内容 | 時間 |
|------|------|------|
| SQL ビュー作成 | `v_location_summary` | 0.5h |
| `js/locations.js` 変更 | タブ切替 + マップ描画 + セル詳細 + KPI | 2.5h |
| `js/locations.js` 変更 | コード形式バリデーション + 自動分解 | 0.5h |
| `index.html` CSS 追加 | マップグリッド + セルスタイル + レスポンシブ | 1h |
| テスト | 全ゾーン表示 + クリック + モバイル + バリデーション | 0.5h |
| **合計** | | **約5時間** |

---

## 12. リスク評価

| リスク | 影響度 | 対策 |
|--------|--------|------|
| aisle/rack が NULL のロケーション | 中 | NULL の場合「未分類」行/列にまとめて表示 |
| ゾーンが1つしかない | なし | ドロップダウンは表示するが1つなら自動選択 |
| 既存データがコード形式に違反 | 低 | バリデーションは新規登録時のみ適用。既存データは影響なし |
| シードの aisle-rack 組が不完全（02-03 がない） | なし | グリッドは実在する組のみ表示。歯抜けは空欄 |

---

## 13. 将来拡張

| 機能 | P2対応 | 将来対応 |
|------|--------|---------|
| ゾーン別マップ | ○ | — |
| セルクリック詳細 | ○ | — |
| コード形式バリデーション | ○ | — |
| capacity 活用時の充填率表示 | × | capacity 運用開始後に使用中セルを4段階に細分化 |
| 棚卸中マーキング | × | P3以降 |
| ヒートマップ（入出庫頻度） | × | inventory_movements から集計 |
| ドラッグ&ドロップ移動 | × | 移動画面との連携 |
| 3Dビュー（段別表示） | × | level を z 軸にした立体表示 |

---

*設計書ここまで（v2）。承認後に P2 を実装します。*
