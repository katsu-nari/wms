# P3 スキャン専用画面 設計書

| 項目 | 内容 |
|------|------|
| フェーズ | P3 |
| 対象機能 | スキャン専用画面（scan page） |
| ステータス | 設計中（未実装） |
| 作成日 | 2026-06-05 |

---

## 1. 現在のスキャン処理フロー

### 1.1 実装箇所一覧

| ファイル | 関数 | 用途 |
|---------|------|------|
| `js/app.js` L317-373 | `startScan(callback)` | スキャンオーバーレイを開き、コールバックを登録 |
| `js/app.js` L336-342 | `submitManualScan()` | 手動入力を確定し、コールバックを呼び出す |
| `js/app.js` L344-364 | `handleScanPhoto(input)` | 写真ファイルをデコードし、コールバックを呼び出す |
| `js/app.js` L366-369 | `closeScanOverlay()` | オーバーレイを閉じる |
| `js/app.js` L371-373 | `scanBtnHtml(onclick)` | スキャンボタンHTML生成ユーティリティ |
| `js/inventory.js` L63-68 | `invScan()` | スキャン結果を在庫検索バーに流し込む |
| `js/inbound.js` L132-140 | `ibScanRow(row)` | スキャン結果を入庫明細の指定行JANフィールドに流し込む |
| `js/outbound.js` L143-151 | `obScanRow(row)` | スキャン結果を出庫明細の指定行JANフィールドに流し込む |

### 1.2 スキャン処理フロー（現状）

```
ユーザー操作                  app.js                   呼び出し元
─────────────────────────────────────────────────────────────────
スキャンボタン押下  ──→  startScan(callback)
                              ↓
                    _scanCallback = callback
                    scanOverlay.style.display = 'flex'
                              ↓
      ┌──────────────────────┴──────────────────────┐
      │ 方法1: カメラ撮影                              │ 方法2: 手動入力
      │ <input type="file" capture="environment">    │ <input type="text">
      ↓                                               ↓
handleScanPhoto(input)                     submitManualScan()
      ↓                                               ↓
Html5Qrcode.scanFile(file)         (文字列をそのまま使用)
      ↓
decodedText
      └──────────────────────┬──────────────────────┘
                              ↓
                    closeScanOverlay()
                    _scanCallback(decodedText)
                              ↓
               ┌──────────────┼──────────────┐
               ↓              ↓              ↓
         invSearch        ibRow[n].jan    obRow[n].jan
         （在庫検索）     （入庫明細）    （出庫明細）
```

### 1.3 ライブラリ

- `html5-qrcode@2.3.8` を CDN 経由でロード済み（`index.html` L366）
- 使用メソッド: `Html5Qrcode.scanFile(file, false)` — 静的ファイル読み取り専用
- **未使用**: `Html5QrcodeScanner` — ライブカメラストリームに対応するクラス（同ライブラリに含まれる）

---

## 2. 問題点

### 2.1 UX上の問題

| # | 問題 | 影響 |
|---|------|------|
| P3-1 | **写真キャプチャのみ**。カメラアプリを起動→撮影→デコードのステップが多く、倉庫作業には遅すぎる | 高 |
| P3-2 | **専用画面がない**。入庫・出庫各画面でのフォームに付随したスキャンであり、「スキャンしてから何をするか決める」フローがない | 高 |
| P3-3 | **スキャン後の文脈が固定**。入庫モーダルで開いた場合は入庫明細への流し込みしかできない | 中 |
| P3-4 | **スキャン履歴なし**。同じ商品を連続してスキャンしても累積されない | 中 |

### 2.2 実装上の問題

| # | 問題 | 影響 |
|---|------|------|
| P3-5 | **グローバル `_scanCallback`** が 1 つだけ存在する。複数モーダルが同時に `startScan()` を呼ぶと後勝ちになる（現状は同時に 1 つしか開かないため潜在的リスク止まり） | 低 |
| P3-6 | `Html5QrcodeScanner`（ライブストリーム）が使われておらず、ライブラリの能力を活かせていない | 中 |

---

## 3. 再利用可能なコード

### 3.1 そのまま再利用できる関数

| 関数 | 場所 | 用途 |
|------|------|------|
| `handleScanPhoto(input)` | `app.js` L344 | 写真スキャンのデコード処理 |
| `closeScanOverlay()` | `app.js` L366 | オーバーレイ制御（既存画面との共用） |
| `toast()` | `app.js` L251 | 結果通知 |
| `openModal()` / `closeModal()` | `app.js` L233 | クイックアクションのダイアログ |
| `fmtDate()` | `app.js` L268 | 期限表示 |
| `statusBadge()` | `app.js` L279 | ステータス表示 |
| `conditionLabel()` | `app.js` L297 | 保管条件表示 |
| `isOperator()` | `app.js` L315 | 権限チェック |

### 3.2 参照パターンとして再利用できるコード

| パターン | 参照元 |
|---------|--------|
| JAN → product 解決 | `ibJanLookup()` (inbound.js L142) / `obJanLookup()` (outbound.js L120) |
| 在庫一覧取得 | `v_inventory_with_names` 参照 (inventory.js L47) |
| 棚入れ完了 RPC | `fn_inbound_putaway` 呼び出し (inbound.js L319) |
| ピッキング完了 RPC | `fn_outbound_pick` 呼び出し (outbound.js L271) |
| ゾーンバッジ | `zoneBadge()` (locations.js L96) |
| タブ切替パターン | `setLocTab()` (locations.js L23) |
| CSS コンポーネント | `.tabs`, `.tab`, `.card`, `.badge`, `.kpi`, `.fl`, `.fr`, `.sbar` など全共通 |

### 3.3 Html5QrcodeScanner（ライブストリーム）

既にロード済みのライブラリで使用可能。新規コードは以下のみ:

```javascript
const scanner = new Html5QrcodeScanner('scan-reader', { fps: 10, qrbox: 250 });
scanner.render(onScanSuccess, onScanError);
// 停止: scanner.clear()
```

`<div id="scan-reader">` を置くだけでビューファインダーが展開される。

---

## 4. 新規作成が必要なコード

### 4.1 ファイル構成

| ファイル | 変更種別 | 概要 |
|---------|---------|------|
| `js/scan.js` | **新規** | スキャン専用画面ロジック（約 250〜300 行想定） |
| `index.html` | **変更** | ナビ項目追加、`page-scan` div 追加、CSS 追加（約 20 行） |
| `js/app.js` | **変更** | `PAGE_TITLES` に `scan: 'スキャン'` を追加（1 行） |

### 4.2 `js/scan.js` に必要な関数

```
RENDER_FNS.scan          — ページ描画、ライブスキャナー初期化
setScanMode(mode)        — モード切替（在庫確認 / 入庫受付 / ピッキング）
startLiveScanner()       — Html5QrcodeScanner 起動
stopLiveScanner()        — scanner.clear() でリソース解放
onScanResult(janCode)    — スキャン成功コールバック（全モード共通エントリ）
lookupProduct(janCode)   — JAN → products テーブル解決
showInventoryResult(product)  — 在庫確認モード: 在庫一覧を表示
showInboundResult(product)    — 入庫受付モード: 未完了 inbound_items 一覧
showPickResult(product)       — ピッキングモード: 未完了 outbound_items 一覧
execQuickPutaway(itemId, locId, qty)  — fn_inbound_putaway を呼ぶ
execQuickPick(itemId, invId, qty)     — fn_outbound_pick を呼ぶ
addScanHistory(product, janCode)      — セッション内スキャン履歴に追記
renderScanHistory()      — 履歴リスト再描画
```

---

## 5. DB変更の有無

**変更なし。** 既存のテーブル・ビュー・RPC 関数で必要な操作はすべてカバーされている。

| 操作 | 使用するリソース |
|------|----------------|
| JAN → 商品解決 | `products` テーブル（`jan_code` カラム、既存インデックスあり） |
| 商品の在庫一覧 | `v_inventory_with_names`（`product_id` で絞り込み） |
| 未完了入庫明細 | `inbound_items` JOIN `inbound_orders`（`product_id` + `status` 絞り込み） |
| 未完了出庫明細 | `outbound_items` JOIN `outbound_orders`（`product_id` + `status` 絞り込み） |
| 棚入れ実行 | `fn_inbound_putaway(p_item_id, p_location, p_qty)` |
| ピッキング実行 | `fn_outbound_pick(p_item_id, p_inventory_id, p_qty)` |

---

## 6. 推奨実装方式

### 6.1 スキャン方式

**ライブカメラ（`Html5QrcodeScanner`）をメインとし、手動入力をフォールバック**に採用する。

| 方式 | メリット | デメリット | 採用 |
|------|---------|-----------|------|
| 写真キャプチャ（現状） | 既存コード再利用 | 操作 3 ステップ、遅い | フォールバック |
| **ライブカメラ（推奨）** | 連続スキャン可、1 ステップ | iOS Safari では getUserMedia 許可が必要 | **メイン** |
| 手動入力 | 確実 | キーボード操作が必要 | フォールバック |

iOS Safari では `https://` 上であれば getUserMedia が利用可能（GitHub Pages は HTTPS のため問題なし）。

### 6.2 モード設計

```
モード A: 在庫確認（デフォルト）
  スキャン → 商品名・在庫数・ロケーション一覧を即表示
  アクション: なし（閲覧のみ）

モード B: 入庫受付
  スキャン → その商品の未完了 inbound_items 一覧を表示
  アクション: 行を選択 → 棚入れ完了ダイアログ（数量・ロケーション指定） → fn_inbound_putaway

モード C: ピッキング
  スキャン → その商品の未完了 outbound_items 一覧を表示（FIFO 順）
  アクション: 行を選択 → ピッキング完了ダイアログ（数量・在庫行指定） → fn_outbound_pick
```

### 6.3 ページ遷移時のリソース管理

`RENDER_FNS.scan` が呼ばれるたびにスキャナーを初期化する。  
別ページに遷移した際（`go()` 呼び出し時）にスキャナーを停止する必要がある。  
`go()` 関数に「前ページの cleanup フック」を追加するか、`RENDER_FNS.scan` 内でページ離脱を `MutationObserver` で検知する方法を採用する。

**推奨**: `go()` に `if (App.currentPage === 'scan') stopLiveScanner()` の早期判定を 1 行追加する（最小変更）。

### 6.4 権限

| 機能 | viewer | operator | admin |
|------|:------:|:--------:|:-----:|
| 在庫確認スキャン | ○ | ○ | ○ |
| 入庫受付（棚入れ）| — | ○ | ○ |
| ピッキング | — | ○ | ○ |

モード B / C は `isOperator()` チェックで制御。非権限者にはモード選択肢を非表示にする。

---

## 7. 画面レイアウト案

```
┌─────────────────────────────────────┐
│ [ハンバーガー]  スキャン              │  ← topbar（既存）
├─────────────────────────────────────┤
│ ┌─────────┬──────────┬──────────┐  │
│ │在庫確認 │ 入庫受付  │ ピッキング│  │  ← モードタブ（.tabs/.tab）
│ └─────────┴──────────┴──────────┘  │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │                                 │ │
│ │      ライブカメラビューファインダー  │ │  ← Html5QrcodeScanner
│ │      (#scan-reader)             │ │
│ │                                 │ │
│ └─────────────────────────────────┘ │
│  [📷 写真で読み取る] [手動入力]        │  ← フォールバック
│                                     │
│ ── スキャン結果 ─────────────────── │
│ ┌─────────────────────────────────┐ │
│ │ [商品名]               [バッジ]  │ │  ← 結果カード（.card）
│ │ SKU: P-00001  JAN: 490...       │ │
│ │ 保管条件: 常温                   │ │
│ ├─────────────────────────────────┤ │
│ │ ロケーション   ロット  在庫   操作 │ │  ← モード別テーブル
│ │ A-01-01-1-A   —     120   [実行] │ │
│ │ A-02-01-1-A   L002   50   [実行] │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ── 今回のスキャン履歴 ──────────────  │
│  P-00001 ミネラルウォーター 500ml    │  ← セッション内履歴（最新 10 件）
│  P-00007 冷凍餃子 12個入             │
└─────────────────────────────────────┘
```

### 7.1 モバイル特有の考慮点

- ビューファインダーは `width: 100%; max-width: 100%` でフル幅表示
- 結果テーブルは `.tw`（横スクロール）で対応
- ボトムナビ分（60px）のパディングは既存 `.content` スタイルが処理済み
- サイドバーナビへの項目追加は OPERATION セクションに配置（scan はオペレーション業務）
- モバイルボトムナビへの追加は現状 5 項目のため追加は行わず、ドロワーのみ対応

---

## 8. 工数見積

| 作業 | 想定行数 | 工数 |
|------|---------|------|
| `js/scan.js` 新規作成 | 約 280 行 | 3.0 h |
| `index.html` ナビ・div・CSS 追加 | 約 25 行 | 0.5 h |
| `js/app.js` PAGE_TITLES + go() cleanup 1 行追加 | 2 行 | 0.25 h |
| 動作確認（PC ブラウザ + モバイル想定） | — | 1.0 h |
| **合計** | **約 307 行** | **4.75 h** |

### 8.1 リスク

| リスク | 対策 |
|--------|------|
| iOS Safari での getUserMedia 許可ダイアログ | HTTPS（GitHub Pages）であれば初回のみ許可を求めるだけで動作する |
| 別ページ遷移時にカメラが停止しない | `go()` に 1 行の cleanup を追加して確実に `scanner.clear()` を呼ぶ |
| `Html5QrcodeScanner` が div を上書きするため再描画時に重複 | `renderScan()` 冒頭で `stopLiveScanner()` を安全に呼ぶ |
| ライブスキャンが利用できない環境 | 写真キャプチャ・手動入力にフォールバックするため業務影響なし |
