# Phase 1 着手前 詳細仕様整理
## wms_supabase.html ベース — 変更前後の完全対照表

**作成日**: 2026-06-05
**対象**: Phase 1（認証・RLS・XSS対策・アトミック処理・スキャン記録）
**原則**: 既存UI変更禁止・ボタン配置変更禁止・メニュー追加最小限

---

## 1. 追加される Supabase テーブル一覧

Phase 1 で**新規作成**するテーブルは以下の3つ。既存4テーブル（inventory / inbound / outbound / clients）は別途「2.」で扱う。

| テーブル名 | 用途 | 作成タイミング |
|------------|------|--------------|
| `profiles` | ログインユーザーの情報・役割を格納。Supabase Auth の `auth.users` と1対1でリンク | P1-1（認証追加）と同時 |
| `login_attempts` | ログイン試行の成否を記録。5回失敗で15分ロック判定に使用 | P1-1（認証追加）と同時 |
| `scan_history` | スキャン処理の操作ログを永続化。現状は画面DOM のみで再起動時消滅 | P1-5（スキャン記録）と同時 |

### 各テーブルの列定義

#### profiles
| 列名 | 型 | 内容 |
|------|-----|------|
| id | uuid PK | auth.users の id と同一（ON DELETE CASCADE） |
| employee_number | text NOT NULL UNIQUE | 社員番号（ログインID） |
| display_name | text | 表示名（サイドバーに表示） |
| role | text NOT NULL default 'viewer' | 'admin' / 'operator' / 'viewer' |
| is_locked | bool NOT NULL default false | 永久ロック（管理者が手動設定） |
| locked_until | timestamptz | 一時ロック解除日時（自動設定） |
| failed_count | int NOT NULL default 0 | 直近15分の失敗回数 |
| last_login_at | timestamptz | 最終ログイン日時 |
| created_at | timestamptz NOT NULL default now() | 作成日時 |

#### login_attempts
| 列名 | 型 | 内容 |
|------|-----|------|
| id | bigserial PK | 自動採番 |
| employee_number | text NOT NULL | 試行した社員番号 |
| success | bool NOT NULL | 成否 |
| attempted_at | timestamptz NOT NULL default now() | 試行日時 |

#### scan_history
| 列名 | 型 | 内容 |
|------|-----|------|
| id | uuid PK default gen_random_uuid() | 自動生成 |
| barcode | text NOT NULL | スキャンした JAN/バーコード |
| product_name | text | 商品名（スキャン時点のスナップショット） |
| qty | int NOT NULL | 処理数量 |
| type | text NOT NULL | '入庫' / '出庫' |
| location | text | 処理ロケーション |
| created_by | uuid references profiles(id) | 操作者（ログインユーザー） |
| created_at | timestamptz NOT NULL default now() | 操作日時 |

---

## 2. 既存テーブルへの変更内容

既存テーブルは**構造変更を最小限**にする。追加列はすべて NULL 許容（既存データへの影響ゼロ）。

### inventory テーブル

| 変更種別 | 列名 | 型 | 理由 |
|---------|------|-----|------|
| 列追加 | `updated_by` | uuid references profiles(id) | アトミック処理後に操作者を記録するため |

その他の列は**変更なし**。

### inbound テーブル

| 変更種別 | 列名 | 型 | 理由 |
|---------|------|-----|------|
| 列追加 | `completed_by` | uuid references profiles(id) | 入庫完了操作者の記録 |
| 列追加 | `completed_at` | timestamptz | 入庫完了日時の記録 |

その他の列は**変更なし**。

### outbound テーブル

| 変更種別 | 列名 | 型 | 理由 |
|---------|------|-----|------|
| 列追加 | `completed_by` | uuid references profiles(id) | 出庫完了操作者の記録 |
| 列追加 | `completed_at` | timestamptz | 出庫完了日時の記録 |

その他の列は**変更なし**。

### clients テーブル

**変更なし。** Phase 1 では clients テーブルに一切手を加えない。

---

## 3. データ移行が必要か

| 項目 | 必要か | 理由 |
|------|--------|------|
| 既存の inventory データ | **不要** | 列追加は NULL 許容のため、既存行に影響なし |
| 既存の inbound データ | **不要** | 列追加は NULL 許容 |
| 既存の outbound データ | **不要** | 列追加は NULL 許容 |
| 既存の clients データ | **不要** | 変更なし |
| profiles（初期ユーザー） | **必要（手動）** | 最初の管理者ユーザーを Supabase Auth + profiles に手動作成する必要あり |
| scan_history | **不要** | 新規テーブルのため、過去履歴は存在しない（画面DOMのみだったため） |

### 初期ユーザー作成の手順（Phase 1 リリース時に1回のみ実施）

1. Supabase Dashboard → Authentication → Users → Add User
2. Email: `{社員番号}@wms.internal`、Password: 初期PIN（5桁数字）
3. 作成された `auth.users.id` を `profiles` テーブルに INSERT
4. role を `admin` に設定

---

## 4. 既存データが消えるリスクがある箇所

| リスク | 発生条件 | 対策 |
|--------|---------|------|
| **RLS 有効化による全データ参照不可** | P1-2（RLS設定）を P1-1（認証）より先に実施した場合、誰もデータを読めなくなる | **必ず P1-1 完了・動作確認後に P1-2 を実施する**。実施順序を厳守 |
| **RLS ポリシーの設定ミス** | SELECT ポリシーを誤って設定した場合、特定テーブルが参照不可になる | RLS 適用前に Supabase Dashboard で必ず SELECT テストを実施する |
| **アトミック RPC 関数の誤実装** | P1-4 の PostgreSQL 関数にバグがある場合、入庫完了・出庫完了が失敗する | 既存の `complIB` / `complOB` をフォールバックとして残した上で本番切り替え |
| **既存データへの直接影響** | **なし** | テーブル構造変更は列追加（NULL許容）のみ。既存行の削除・更新は一切なし |

**最重要注意**: 実施順序
```
P1-3（XSS） → P1-1（認証） → P1-5（スキャン記録） → P1-4（アトミック） → P1-2（RLS）
```
RLS は**最後**に有効化する。

---

## 5. 現在の画面構成に追加される画面一覧

Phase 1 では**既存8画面は一切変更しない**。追加されるのはログイン画面のみ。

| 変更 | 画面名 | 表示条件 | 既存画面への影響 |
|------|--------|---------|----------------|
| **新規追加** | ログイン画面 | 未ログイン時にアプリ全体の前面に表示 | 既存8画面はその背後に存在したまま |
| 変更なし | ダッシュボード | ログイン後（従来と同じ） | なし |
| 変更なし | クライアント管理 | ログイン後（従来と同じ） | なし |
| 変更なし | 入庫処理 | ログイン後（従来と同じ） | なし |
| 変更なし | 出庫処理 | ログイン後（従来と同じ） | なし |
| 変更なし | スキャン | ログイン後（従来と同じ） | なし |
| 変更なし | 在庫一覧 | ログイン後（従来と同じ） | なし |
| 変更なし | 商品マスタ管理 | ログイン後（従来と同じ） | なし |
| 変更なし | ロケーション管理 | ログイン後（従来と同じ） | なし |

### サイドバーフッターへの最小変更（1箇所のみ）

```
変更前: 「田中 太郎 / 倉庫管理者」が固定テキストで表示（L194）
変更後: ログインユーザーの display_name と role を表示 + 「ログアウト」リンク追加
```

この1箇所のみ変更。それ以外のサイドバー・ボトムナビ・ページレイアウトは**完全に現状維持**。

---

## 6. ログイン後の権限ごとの利用可能画面

Phase 1 では権限ごとのメニュー出し分けは**行わない**。全ロールが同じ画面を参照できる。操作制限はサーバー側（RLS / RPC 関数）で行うため、画面上の変化は最小限。

| 画面 | admin | operator | viewer | Phase 1 での変化 |
|------|-------|----------|--------|-----------------|
| ダッシュボード（閲覧） | ○ | ○ | ○ | なし |
| クライアント管理（閲覧） | ○ | ○ | ○ | なし |
| クライアント管理（登録） | ○ | ○ | ○ | Phase 1 では全員可（Phase 2 で制限） |
| 入庫処理（閲覧） | ○ | ○ | ○ | なし |
| 入庫処理（登録・完了） | ○ | ○ | × | **RLS で viewer の UPDATE を拒否**。ボタンは表示されるが押すとエラー toast |
| 出庫処理（閲覧） | ○ | ○ | ○ | なし |
| 出庫処理（登録・完了） | ○ | ○ | × | **RLS で viewer の INSERT/UPDATE を拒否** |
| スキャン（閲覧） | ○ | ○ | ○ | なし |
| スキャン（処理実行） | ○ | ○ | × | **RPC 関数内でロール確認、viewer は拒否** |
| 在庫一覧（閲覧・CSV） | ○ | ○ | ○ | なし |
| 商品マスタ（閲覧・CSV） | ○ | ○ | ○ | なし |
| 商品マスタ（登録・編集・削除） | ○ | ○ | × | **RLS で viewer の書き込みを拒否** |
| ロケーション管理（閲覧） | ○ | ○ | ○ | なし |

**UI ボタンの出し分けは Phase 2 で実装**。Phase 1 では「ボタンは見えるが操作するとサーバー側でエラー」という動作になる。エラーは既存の toast（赤）で表示される。

---

## 7. スキャン機能への影響

### 変更前後の対照

| 項目 | 変更前 | 変更後（Phase 1） |
|------|--------|-----------------|
| スキャン結果の保存先 | 画面 DOM のみ（`scanTb` に `tr` を追加）。リロードで消える | `scan_history` テーブルに INSERT。リロード後も参照可能 |
| 「本日: N件」のカウント | `S.scanN++` でメモリカウント。リロードでリセット | 本日の `scan_history` 件数を DB から取得 |
| スキャン履歴テーブルの初期表示 | 空（リロード後消えている） | ページ遷移時に本日のスキャン履歴を DB から読み込んで表示 |
| 在庫更新方法 | `sb.update('inventory', id, {qty: newQty})` の直接 PATCH | `sb.rpc('fn_scan_process', {...})` に変更。サーバー側でアトミックに処理 |
| 操作者の記録 | なし | `scan_history.created_by` にログインユーザーの ID を記録 |
| カメラスキャン UI | 変更なし | **変更なし**（html5-qrcode の表示・動作は現状維持） |
| 手動入力 UI | 変更なし | **変更なし** |
| 入庫/出庫モード切替タブ | 変更なし | **変更なし** |
| クライアント・ロケーション・数量入力 | 変更なし | **変更なし** |
| 「処理実行」ボタン位置・デザイン | 変更なし | **変更なし** |
| viewer ロールでの処理実行 | 全員可能 | RPC 関数がエラーを返し toast でエラー表示（ボタン自体は残る） |

### スキャン処理の内部フロー変化

```
【変更前】processScan（L784〜799）

1. S.curScan.id が存在する場合:
   新qty = 現qty ± 処理qty を計算（クライアント側）
   sb.update('inventory', id, {qty: 新qty})  ← 直接 PATCH（非アトミック）
2. DOM に tr を追加（DBに保存されない）
3. scanQty を 1 にリセット

【変更後】processScan（Phase 1）

1. sb.rpc('fn_scan_process', {
     p_barcode: code,
     p_qty: qty,
     p_mode: '入庫'/'出庫',
     p_location: loc,
     p_user: currentUserId
   })
   サーバー側: BEGIN → FOR UPDATE → qty加減算 → scan_history INSERT → COMMIT
2. DB から本日のスキャン履歴を再取得して scanTb に描画
3. scanQty を 1 にリセット

呼び出し元（ボタン・カメラ読取後の処理）は変更なし。
画面表示は変更なし。処理が成功すれば同じ toast が表示される。
```

---

## 8. 入庫・出庫処理への影響

### 入庫処理

| 項目 | 変更前 | 変更後（Phase 1） |
|------|--------|-----------------|
| 入庫一覧の表示 | `renderIB` が `sb.get('inbound')` で全件取得 | **変更なし** |
| 「+ 入庫登録」モーダル UI | 10行スリップ・クライアント選択・伝票番号等 | **変更なし（レイアウト・フィールド全て現状維持）** |
| 入庫登録処理（submitIB） | `sb.insert('inbound', {...})` を最大10行 | **変更なし**（登録処理は RPC 化の対象外） |
| 「完了」ボタンの位置・デザイン | 変更なし | **変更なし** |
| 「完了」ボタン押下後の処理（complIB） | 3ステップ非アトミック（詳細は下記） | `sb.rpc('fn_inbound_complete', {...})` に置き換え |
| 完了後の在庫反映 | `sb.update` または `sb.insert` で在庫を直接更新 | RPC 関数内でアトミックに更新（結果は同じ） |
| 完了後の操作者記録 | なし | `inbound.completed_by` / `completed_at` が自動記録 |
| 完了後の画面更新 | `renderIB()` を再呼び出し | **変更なし** |
| エラー発生時の表示 | なし（在庫が狂うだけ） | toast でエラーメッセージ表示（既存 toast 関数を使用） |

```
【変更前】complIB（L542〜559）

await sb.update('inbound', id, {status:'完了', actual:qty})   ← step1
const invRows = await sb.get('inventory', '&barcode=eq.'+jan)  ← step2（非同期の隙間）
if (invRows.length) {
  await sb.update('inventory', id, {qty: prev+qty})             ← step3
} else {
  await sb.insert('inventory', {...})
}

問題: step2とstep3の間に別ユーザーがstep2を実行すると在庫数が狂う

【変更後】complIB（Phase 1）

const {error} = await sb.rpc('fn_inbound_complete', {p_inbound_id: id, p_user: userId})
if (error) { toast(error.message, 'e'); return; }
renderIB()

サーバー側（PostgreSQL関数）:
BEGIN
  SELECT ... FOR UPDATE  ← ロック取得
  UPDATE inbound SET status='完了', completed_by=..., completed_at=now()
  UPDATE/INSERT inventory  ← アトミックに在庫加算
COMMIT
```

### 出庫処理

| 項目 | 変更前 | 変更後（Phase 1） |
|------|--------|-----------------|
| 出庫一覧の表示 | `renderOB` が全件取得 | **変更なし** |
| 「+ 出庫登録」モーダル UI | クライアント・JAN・数量・出荷先・日付・優先度 | **変更なし（レイアウト・フィールド全て現状維持）** |
| 出庫登録処理（submitOB） | クライアント側在庫チェック後 `sb.insert('outbound', {...})` | **変更なし**（登録処理は RPC 化対象外） |
| 「完了」ボタンの位置・デザイン | 変更なし | **変更なし** |
| 「完了」ボタン押下後の処理（complOB） | 2ステップ非アトミック（詳細は下記） | `sb.rpc('fn_outbound_complete', {...})` に置き換え |
| 在庫不足時の動作 | `Math.max(0, qty-r.qty)` でマイナスを防ぐだけ（実際の不足を無視） | RPC 関数が `insufficient stock` エラーを返し、toast で表示。在庫は減算されない |
| 完了後の操作者記録 | なし | `outbound.completed_by` / `completed_at` が自動記録 |

```
【変更前】complOB（L567〜572）

await sb.update('outbound', id, {status:'出荷済み'})  ← 先に完了にする
const iv = await sb.get('inventory', '&barcode=eq.'+sku)
if (iv.length) await sb.update('inventory', id, {qty: Math.max(0, qty-r.qty)})
// → 在庫不足でも出荷済みになる。同時操作で二重出庫も起きる

【変更後】complOB（Phase 1）

const {error} = await sb.rpc('fn_outbound_complete', {p_outbound_id: id, p_user: userId})
if (error) { toast(error.message, 'e'); return; }  // 在庫不足エラー等を表示
renderOB()

サーバー側（PostgreSQL関数）:
BEGIN
  SELECT qty FROM inventory WHERE barcode=sku FOR UPDATE
  IF qty < r.qty THEN RAISE EXCEPTION '在庫不足'
  UPDATE inventory SET qty = qty - r.qty
  UPDATE outbound SET status='出荷済み', completed_by=..., completed_at=now()
COMMIT
```

---

## 9. 在庫更新処理がどう変わるか

### 在庫が更新される3つのケースの変化

| ケース | 更新関数 | 変更前の方法 | 変更後の方法 |
|--------|---------|------------|------------|
| 入庫完了 | `complIB` | JS で読み書き（3ステップ、非アトミック） | RPC `fn_inbound_complete`（アトミック） |
| 出庫完了 | `complOB` | JS で読み書き（2ステップ、非アトミック） | RPC `fn_outbound_complete`（アトミック） |
| スキャン処理 | `processScan` | JS で読み書き（2ステップ、非アトミック） | RPC `fn_scan_process`（アトミック） |

### 在庫数の計算ロジック変化

| 項目 | 変更前 | 変更後 |
|------|--------|--------|
| 計算場所 | ブラウザ（JS）| Supabase PostgreSQL 関数 |
| ロック取得 | なし | `SELECT ... FOR UPDATE` |
| 複数ユーザー同時操作 | 在庫数が不正確になる | 順次処理（後続はロック待ち） |
| 在庫マイナス防止 | `Math.max(0, ...)` でクリップ（実際は不足でも出庫完了になる） | `IF qty < required THEN RAISE EXCEPTION` でロールバック |
| 操作者の記録 | なし | `updated_by` / `completed_by` に自動記録 |
| エラー時の動作 | 在庫が中途半端な状態になる可能性 | 全処理がロールバックされ元の状態を保持 |

---

## 総括：変更前後 一覧表

### テーブル構成

| テーブル | 変更前 | 変更後（Phase 1） |
|---------|--------|-----------------|
| `inventory` | 既存列のみ | `updated_by` 列追加（NULL許容） |
| `inbound` | 既存列のみ | `completed_by`, `completed_at` 列追加（NULL許容） |
| `outbound` | 既存列のみ | `completed_by`, `completed_at` 列追加（NULL許容） |
| `clients` | 既存列のみ | **変更なし** |
| `profiles` | 存在しない | **新規作成** |
| `login_attempts` | 存在しない | **新規作成** |
| `scan_history` | 存在しない | **新規作成** |

### 画面構成

| 画面 | 変更前 | 変更後（Phase 1） |
|------|--------|-----------------|
| ログイン画面 | 存在しない | **新規追加**（アプリ前面に表示、未ログイン時のみ） |
| ダッシュボード | そのまま表示 | ログイン後に表示（内容・レイアウト変更なし） |
| クライアント管理 | そのまま表示 | ログイン後に表示（変更なし） |
| 入庫処理 | そのまま表示 | ログイン後に表示（変更なし） |
| 出庫処理 | そのまま表示 | ログイン後に表示（変更なし） |
| スキャン | そのまま表示 | ログイン後に表示（カメラ・UI 変更なし） |
| 在庫一覧 | そのまま表示 | ログイン後に表示（変更なし） |
| 商品マスタ管理 | そのまま表示 | ログイン後に表示（変更なし） |
| ロケーション管理 | そのまま表示 | ログイン後に表示（変更なし） |

### サイドバーフッター（唯一の UI 変更箇所）

| 項目 | 変更前 | 変更後（Phase 1） |
|------|--------|-----------------|
| ユーザー名 | 「田中 太郎」固定テキスト（L194） | ログインユーザーの `display_name` を動的表示 |
| 役職表示 | 「倉庫管理者」固定テキスト | ログインユーザーの `role`（管理者/オペレーター/閲覧者） |
| ログアウト | 存在しない | テキストリンク「ログアウト」を追加（デザインは既存スタイルに合わせる） |
| アバター文字 | 「田」固定 | `display_name` の先頭1文字 |

### 処理フロー

| 処理 | 変更前 | 変更後（Phase 1） |
|------|--------|-----------------|
| 入庫完了（complIB） | JS で3ステップ直接 API 呼び出し（非アトミック） | RPC `fn_inbound_complete` 1回呼び出し（アトミック） |
| 出庫完了（complOB） | JS で2ステップ直接 API 呼び出し（非アトミック） | RPC `fn_outbound_complete` 1回呼び出し（アトミック） |
| スキャン処理（processScan） | JS で在庫直接更新 + DOM のみ履歴 | RPC `fn_scan_process` 1回呼び出し + DB 履歴 |
| 商品マスタ登録（submitMaster） | `sb.insert('inventory', ...)` 直接 | **変更なし**（Phase 2 で対応） |
| XSS 対策 | innerHTML に DB 値を直接挿入（約30箇所） | `esc()` 関数を通してエスケープ（処理結果・見た目は変わらない） |

### セキュリティ

| 項目 | 変更前 | 変更後（Phase 1） |
|------|--------|-----------------|
| アクセス制御 | なし（URL を知れば誰でも） | ログイン必須（社員番号 + PIN 5桁） |
| RLS（行レベルセキュリティ） | 無効 | 有効化（全テーブル） |
| anon キーの危険性 | 誰でも全データの読み書き可能 | RLS により認証済みユーザーのみ操作可能 |
| XSS | DB 値がそのまま HTML に埋め込まれる | `esc()` 関数によりエスケープ済み |
| ログイン失敗対策 | なし | 15分以内に5回失敗で15分ロック |
| 操作者の追跡 | 不可能 | `completed_by` / `scan_history.created_by` で記録 |

---

## 実装順序（確認事項）

以下の順序で着手する。各ステップ完了後に動作確認してから次へ進む。

```
Step 1: P1-3 XSS対策（esc関数追加）
        → コード変更のみ。既存動作に影響なし。最初に安全に適用できる

Step 2: P1-1 認証機能追加
        → ログインページ追加。profiles / login_attempts テーブル作成
        → この時点ではまだ RLS は無効。認証なしでもアクセス可能な状態

Step 3: P1-5 スキャン履歴DB保存
        → scan_history テーブル作成。processScan に INSERT 追加
        → 認証が入ったので created_by を記録できる

Step 4: P1-4 アトミック在庫操作
        → RPC 関数3本を Supabase に作成
        → complIB / complOB / processScan を RPC 呼び出しに切り替え
        → 動作確認（既存の完了ボタンが正常動作することを確認）

Step 5: P1-2 RLS 有効化
        → 最後に実施。これで外部からの直接 API アクセスが遮断される
        → ログインした状態で全画面の動作を確認してから完了
```
