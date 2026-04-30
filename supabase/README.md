# Supabase マイグレーション適用手順

## 前提

- Supabase プロジェクトが作成済みであること
- SQL Editor（Supabase Dashboard > SQL Editor）を使えること

## 適用順序

以下の順に SQL Editor で実行してください。

```
1. migrations/0001_schema.sql   -- テーブル・インデックス・ビュー・トリガ
2. migrations/0002_rls.sql      -- Row Level Security ポリシー
3. migrations/0003_functions.sql -- RPC 関数（認証/在庫/棚卸）
4. seed.sql                     -- 開発用サンプルデータ
```

## 初回 admin ユーザーの作成

マイグレーション後、管理者ユーザーを手動で作成します。

### 1. Supabase Dashboard > Authentication > Users で新規ユーザーを作成

- Email: `E00001@wms.internal`
- Password: `12345`（初期PIN、後から変更可能）
- Auto Confirm にチェック

### 2. SQL Editor で profiles を登録

```sql
insert into profiles (id, employee_number, display_name, role)
values (
  '<上で作成されたユーザーの UUID>',
  'E00001',
  '管理者',
  'admin'
);
```

### 3. ログイン確認

ブラウザで `index.html` を開き、社員番号 `E00001` / パスワード `12345` でログイン。

## index.html の設定

`index.html` 先頭の定数を自分の Supabase プロジェクトの値に書き換えてください。

```js
const SB_URL = 'https://YOUR_PROJECT.supabase.co';
const SB_KEY = 'YOUR_ANON_KEY';
```

## Supabase CLI を使う場合

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase db seed
```
