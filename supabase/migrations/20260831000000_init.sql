-- テーブル・制約・インデックス（docs/仕様書.md §3）
--
-- 金額はすべて円単位の整数。共有範囲はカテゴリだけが持ち、取引はカテゴリをたどる。

set check_function_bodies = off;

-- ---------------------------------------------------------------- profiles

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  color text not null default '#64748b',
  -- default_category_id の FK は categories を作ってから張る（相互参照のため）
  default_category_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_uq unique (display_name),
  -- 共用 / 個人 は CSV の予約語、: と ; は負担列の区切り（§4.2）
  constraint profiles_display_name_ck check (
    display_name = btrim(display_name)
    and display_name <> ''
    and display_name not in ('共用', '個人')
    and display_name !~ '[:;[:cntrl:]]'
  )
);

comment on table public.profiles is '利用者。表示名は CSV が人を指すのに使うため一意';

-- ----------------------------------------------------------- share_groups

create table public.share_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- 作成者が消えても、グループ自体は他のメンバーが使い続ける
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint share_groups_name_uq unique (name),
  constraint share_groups_name_ck check (
    name = btrim(name) and name <> '' and name <> '個人'
  )
);

comment on table public.share_groups is '共有グループ。個人 は予約語なのでグループ名にできない';

create table public.share_group_members (
  share_group_id uuid not null references public.share_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete restrict,
  default_weight int not null default 1,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (share_group_id, user_id),
  constraint share_group_members_weight_ck check (default_weight >= 0)
);

comment on column public.share_group_members.default_weight is '既定の負担割合の重み。折半なら全員 1';

-- ------------------------------------------------------------- categories

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  share_group_id uuid references public.share_groups (id) on delete cascade,
  owner_id uuid default auth.uid() references auth.users (id) on delete cascade,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  kind text not null,
  name text not null,
  color text not null default '#64748b',
  sort_order int not null default 0,
  is_system boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_kind_ck check (kind in ('income', 'expense')),
  constraint categories_name_ck check (name = btrim(name) and name <> ''),
  -- 共有範囲はどちらか一方だけ
  constraint categories_scope_ck check (num_nonnulls(share_group_id, owner_id) = 1)
);

comment on table public.categories is '取引の分類。共有範囲（share_group_id / owner_id）と収支区分を持つ';

-- 単一の unique では NULL 同士が衝突せず一度も発火しないため、部分一意インデックスに分ける
create unique index categories_group_uq
  on public.categories (share_group_id, kind, name)
  where share_group_id is not null;

create unique index categories_own_uq
  on public.categories (owner_id, kind, name)
  where owner_id is not null;

-- 未分類は共有範囲 × 収支区分ごとに1つ
create unique index categories_sys_group_uq
  on public.categories (share_group_id, kind)
  where is_system and share_group_id is not null;

create unique index categories_sys_own_uq
  on public.categories (owner_id, kind)
  where is_system and owner_id is not null;

alter table public.profiles
  add constraint profiles_default_category_fk
  foreign key (default_category_id) references public.categories (id) on delete set null;

-- ----------------------------------------------------------- transactions

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  -- 取引を未分類へ移すのは delete_category() の仕事。黙って消させない
  category_id uuid not null references public.categories (id) on delete restrict,
  payer_id uuid references auth.users (id) on delete restrict,
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  occurred_on date not null,
  amount int not null,
  splits_are_manual boolean not null default false,
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_amount_ck check (amount > 0)
);

comment on column public.transactions.payer_id is '支払った人。null は「共用」（共用の財布から出した）';
comment on column public.transactions.splits_are_manual is '負担を手入力で編集したか。RPC が決める';

create index transactions_occurred_on_idx on public.transactions (occurred_on);
create index transactions_category_idx on public.transactions (category_id, occurred_on);
create index transactions_payer_idx on public.transactions (payer_id);

create table public.transaction_splits (
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete restrict,
  amount int not null,
  primary key (transaction_id, user_id),
  constraint transaction_splits_amount_ck check (amount >= 0)
);

comment on table public.transaction_splits is
  '負担。合計は取引の金額に一致する。行トリガでは検査できないため upsert_transaction() が末尾で1回検査する';

create index transaction_splits_user_idx on public.transaction_splits (user_id);

-- ---------------------------------------------------------------- budgets

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete cascade,
  month date not null,
  amount int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budgets_category_month_uq unique (category_id, month),
  constraint budgets_amount_ck check (amount > 0),
  -- 月初でない日付を入れると同じ対象月の行が複数できてしまう
  constraint budgets_month_ck check (month = date_trunc('month', month)::date)
);

comment on table public.budgets is 'カテゴリごと・月ごとの支出の上限額。予算なしは行が無いことで表す';

-- ------------------------------------------------------------- updated_at

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger share_groups_touch before update on public.share_groups
  for each row execute function public.touch_updated_at();
create trigger share_group_members_touch before update on public.share_group_members
  for each row execute function public.touch_updated_at();
create trigger categories_touch before update on public.categories
  for each row execute function public.touch_updated_at();
create trigger transactions_touch before update on public.transactions
  for each row execute function public.touch_updated_at();
create trigger budgets_touch before update on public.budgets
  for each row execute function public.touch_updated_at();
