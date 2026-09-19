-- 不足物資の共有リスト。カテゴリ・タグと同じく、ログイン済みの全利用者で共有する。

create table public.missing_supplies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_purchased boolean not null default false,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint missing_supplies_name_ck check (
    name = btrim(name) and name <> '' and char_length(name) <= 100
  )
);

comment on table public.missing_supplies is
  'ログイン済みの全利用者で共有する不足物資。購入済みの行も履歴として残す';

create index missing_supplies_order_idx
  on public.missing_supplies (is_purchased, created_at, id);

create trigger missing_supplies_touch before update on public.missing_supplies
  for each row execute function public.touch_updated_at();

alter table public.missing_supplies enable row level security;
alter table public.missing_supplies force row level security;

revoke all on public.missing_supplies from anon, authenticated;
grant select, delete on public.missing_supplies to authenticated;
grant insert (name) on public.missing_supplies to authenticated;
grant update (is_purchased) on public.missing_supplies to authenticated;

create policy missing_supplies_select on public.missing_supplies
  for select to authenticated using (true);

create policy missing_supplies_insert on public.missing_supplies
  for insert to authenticated with check (created_by = auth.uid() and not is_purchased);

create policy missing_supplies_update on public.missing_supplies
  for update to authenticated using (true) with check (true);

create policy missing_supplies_delete on public.missing_supplies
  for delete to authenticated using (true);
