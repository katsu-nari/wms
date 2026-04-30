# LogiCore WMS データベース設計書

| 項目 | 内容 |
|------|------|
| DBMS | PostgreSQL 15（Supabase） |
| 文字コード | UTF-8 |
| タイムゾーン | Asia/Tokyo（`created_at`等は `timestamptz` で UTC 保存） |
| 論理削除 | `deleted_at timestamptz null` 方式 |
| ID | `uuid`（`gen_random_uuid()`）を主キーに採用 |

## 1. ER 概要

```
profiles ─┐
          │
          ▼ created_by
       inbound ──┐
       outbound ─┼──▶ inventory_movements
       stocktake ┘         ▲
                           │
products ──▶ inventory ────┘
                │
                ▼
            locations
```

## 2. テーブル一覧

| # | 論理名 | 物理名 | 概要 |
|---|--------|--------|------|
| 1 | ユーザープロフィール | `profiles` | `auth.users` に紐づく社員番号・ロール・ロック状態 |
| 1b | ログイン試行ログ | `login_attempts` | 社員番号ベースのレート制限・監査用 |
| 2 | 商品マスタ | `products` | SKU 単位の商品情報 |
| 3 | ロケーションマスタ | `locations` | 保管場所の階層情報 |
| 4 | 在庫 | `inventory` | SKU × ロット × ロケーション単位の現在在庫 |
| 5 | 在庫移動履歴 | `inventory_movements` | 全在庫変動の不変ログ |
| 6 | 入庫ヘッダ | `inbound_orders` | 入庫予定・実績ヘッダ |
| 7 | 入庫明細 | `inbound_items` | 入庫1行ごとの商品・数量 |
| 8 | 出庫ヘッダ | `outbound_orders` | 出庫指示ヘッダ |
| 9 | 出庫明細 | `outbound_items` | 出庫1行ごとの商品・数量・引当在庫 |
| 10 | 棚卸ヘッダ | `stocktakes` | 棚卸指示 |
| 11 | 棚卸明細 | `stocktake_items` | 棚卸1行（ロケーション×SKU の実数） |

## 3. テーブル定義

### 3.1 `profiles`
ログインは **社員番号 + 数字5桁パスワード** で行う。
Supabase Auth 基盤を流用するため、内部的に擬似メール `{employee_number}@wms.internal`
を `auth.users.email` に格納し、`profiles.employee_number` を正規のログインIDとする。

```sql
create table profiles (
  id              uuid primary key references auth.users on delete cascade,
  employee_number text not null unique,         -- 例: E00123
  display_name    text,
  role            text not null check (role in ('admin','operator','viewer')),
  is_locked       bool not null default false,  -- 強制ロック状態
  locked_until    timestamptz,                  -- 一時ロック解除時刻
  failed_count    int  not null default 0,      -- 現在の連続失敗回数
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on profiles (employee_number);
```

### 3.1.1 `login_attempts`（ログイン試行ログ）
ブルートフォース対策の根拠となる監査テーブル。5桁PINは総当たりで10万通りしか
ないため、この表を使ったレート制限を**必須**とする。

```sql
create table login_attempts (
  id               bigserial primary key,
  employee_number  text not null,
  success          bool not null,
  ip_address       inet,
  user_agent       text,
  attempted_at     timestamptz not null default now()
);
create index on login_attempts (employee_number, attempted_at desc);
```

#### ロック判定ルール
| 条件 | 結果 |
|------|------|
| 直近 15 分以内に同一社員番号で失敗 5 回 | `locked_until = now() + 15 min` |
| 直近 24 時間以内に同一社員番号で失敗 20 回 | `is_locked = true`（admin 解除） |
| 成功時 | `failed_count = 0`、`locked_until = null` |

### 3.2 `products`
```sql
create table products (
  id                 uuid primary key default gen_random_uuid(),
  sku                text not null unique,      -- 商品コード
  name               text not null,
  jan_code           text,
  unit               text not null default '個',-- 個/箱/ケース等
  pack_size          int  not null default 1,   -- 入数
  storage_condition  text check (storage_condition in ('ambient','refrigerated','frozen','hazard')),
  min_stock          int  not null default 0,
  track_expiry       bool not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index on products (sku) where deleted_at is null;
create index on products (jan_code) where deleted_at is null;
```

### 3.3 `locations`
```sql
create table locations (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,       -- 例: A-01-03-2-B
  zone              text not null,
  aisle             text,
  rack              text,
  level             text,
  bin               text,
  storage_condition text check (storage_condition in ('ambient','refrigerated','frozen','hazard')),
  capacity          int,
  pick_priority     int not null default 100,   -- 小さいほど優先
  is_active         bool not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on locations (zone, aisle, rack, level, bin);
```

### 3.4 `inventory`
```sql
create table inventory (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id),
  location_id   uuid not null references locations(id),
  lot_no        text not null default '',       -- ロット番号（なければ空文字）
  expiry        date,                            -- 有効期限
  qty           int  not null check (qty >= 0),
  locked_qty    int  not null default 0 check (locked_qty >= 0), -- 棚卸・引当中
  updated_at    timestamptz not null default now(),
  unique (product_id, location_id, lot_no, coalesce(expiry, 'infinity'::date))
);
create index on inventory (product_id);
create index on inventory (location_id);
create index on inventory (expiry) where expiry is not null;
```

### 3.5 `inventory_movements`
不変ログ。すべての在庫変動を記録する。
```sql
create table inventory_movements (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id),
  location_id   uuid not null references locations(id),
  lot_no        text not null default '',
  expiry        date,
  qty_delta     int  not null,                -- +入庫, -出庫
  type          text not null check (type in ('inbound','outbound','move_out','move_in','adjust')),
  ref_type      text,                          -- 'inbound_orders' 等
  ref_id        uuid,                          -- 参照元ID
  note          text,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);
create index on inventory_movements (product_id, created_at desc);
create index on inventory_movements (ref_type, ref_id);
```

### 3.6 `inbound_orders` / `inbound_items`
```sql
create table inbound_orders (
  id           uuid primary key default gen_random_uuid(),
  slip_no      text unique,                    -- 伝票番号
  supplier     text,
  planned_date date,
  status       text not null default 'pending' -- pending/received/inspected/putaway/done/canceled
               check (status in ('pending','received','inspected','putaway','done','canceled')),
  note         text,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table inbound_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references inbound_orders(id) on delete cascade,
  product_id       uuid not null references products(id),
  lot_no           text not null default '',
  expiry           date,
  planned_qty      int  not null check (planned_qty >= 0),
  received_qty     int  not null default 0 check (received_qty >= 0),
  location_id      uuid references locations(id), -- 棚入れ先
  status           text not null default 'pending'
                   check (status in ('pending','received','putaway','done'))
);
create index on inbound_items (order_id);
```

### 3.7 `outbound_orders` / `outbound_items`
```sql
create table outbound_orders (
  id            uuid primary key default gen_random_uuid(),
  slip_no       text unique,
  customer      text,
  planned_date  date,
  status        text not null default 'pending'
                check (status in ('pending','picking','inspected','shipped','canceled')),
  note          text,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table outbound_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references outbound_orders(id) on delete cascade,
  product_id       uuid not null references products(id),
  planned_qty      int  not null check (planned_qty >= 0),
  picked_qty       int  not null default 0 check (picked_qty >= 0),
  from_location_id uuid references locations(id),
  lot_no           text not null default '',
  expiry           date,
  status           text not null default 'pending'
                   check (status in ('pending','picked','inspected','shipped'))
);
create index on outbound_items (order_id);
```

### 3.8 `stocktakes` / `stocktake_items`
```sql
create table stocktakes (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                  -- 例: 2026年4月A棚
  scope_zone    text,                            -- 対象ゾーン
  planned_date  date,
  status        text not null default 'draft'
                check (status in ('draft','counting','reviewing','done','canceled')),
  created_by    uuid references profiles(id),
  approved_by   uuid references profiles(id),
  created_at    timestamptz not null default now(),
  approved_at   timestamptz
);

create table stocktake_items (
  id            uuid primary key default gen_random_uuid(),
  stocktake_id  uuid not null references stocktakes(id) on delete cascade,
  location_id   uuid not null references locations(id),
  product_id    uuid not null references products(id),
  lot_no        text not null default '',
  expiry        date,
  system_qty    int  not null,                   -- スナップショット時の在庫
  counted_qty   int,                             -- 実数（NULL=未カウント）
  diff          int generated always as (coalesce(counted_qty,0) - system_qty) stored,
  counted_by    uuid references profiles(id),
  counted_at    timestamptz
);
create index on stocktake_items (stocktake_id);
create index on stocktake_items (location_id);
```

## 4. 主要な在庫ロジック

### 4.1 入庫完了時
1. `inbound_items.status = 'done'`
2. `inventory` を upsert（同一 SKU×LOT×LOC×期限 があれば加算）
3. `inventory_movements` に `type='inbound'`, `qty_delta=+received_qty` 記録

### 4.2 出庫完了時
1. `outbound_items.status = 'shipped'`
2. `inventory.qty -= picked_qty`（0 になったら行は残すか物理削除かは運用判断、本設計では残す）
3. `inventory_movements` に `type='outbound'`, `qty_delta=-picked_qty`

### 4.3 ロケーション移動時（F-08）
単一トランザクションで 2 行の movement を記録。
1. 移動元: `inventory.qty -= move_qty` / `type='move_out'`, `qty_delta=-move_qty`
2. 移動先: `inventory` upsert `qty += move_qty` / `type='move_in'`, `qty_delta=+move_qty`

### 4.4 棚卸確定時（F-09）
各 `stocktake_items` について `diff != 0` の行を処理:
1. `inventory.qty += diff`
2. `inventory_movements` に `type='adjust'`, `qty_delta=diff`, `ref_type='stocktakes'`
3. `stocktakes.status = 'done'`, `approved_by`, `approved_at` を更新

### 4.5 ロック（同時編集制御）
- 棚卸中 (`stocktakes.status='counting'`) のロケーションに属する `inventory.locked_qty = inventory.qty` にする
- 入出庫処理は `qty - locked_qty > 0` の行のみ対象にする

## 5. Row Level Security（RLS）概要

| テーブル | admin | operator | viewer |
|----------|:-----:|:--------:|:------:|
| `profiles` | R/W（全件）| R（自分のみ）| R（自分のみ）|
| `login_attempts` | R（全件）| Insert（自分の試行のみ）| Insert（自分の試行のみ）|
| `products` | R/W | R | R |
| `locations` | R/W | R | R |
| `inventory` | R/W | R/W | R |
| `inventory_movements` | R/W | R + Insert | R |
| `inbound_*` | R/W | R/W | R |
| `outbound_*` | R/W | R/W | R |
| `stocktakes` | R/W | R + Insert/Update（counting中のみ）| R |
| `stocktake_items` | R/W | R/W（counted_qty のみ）| R |

RLS ポリシーの雛形例（`inventory` の SELECT）:
```sql
alter table inventory enable row level security;
create policy inventory_select on inventory
  for select using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.role in ('admin','operator','viewer')
    )
  );
```

## 6. ビュー・マテビュー（任意）

### 6.1 `v_inventory_with_names`
在庫一覧用に product / location をジョイン済みで返すビュー。
```sql
create view v_inventory_with_names as
select
  i.id, i.product_id, p.sku, p.name as product_name, p.track_expiry,
  i.location_id, l.code as location_code, l.zone, l.storage_condition,
  i.lot_no, i.expiry, i.qty, i.locked_qty, (i.qty - i.locked_qty) as available_qty,
  p.min_stock, (case when i.qty <= p.min_stock then true else false end) as low_stock
from inventory i
join products p on p.id = i.product_id
join locations l on l.id = i.location_id
where p.deleted_at is null;
```

## 7. 初期データ（シード）

- `profiles`: 初回 admin を 1 名手動登録
- `locations`: サンプルゾーン A-E、各 10 棚
- `products`: サンプル 20 SKU

詳細な SQL は `supabase/seed.sql` に配置する想定（P1 フェーズ）。
