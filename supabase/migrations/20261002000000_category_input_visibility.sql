-- カテゴリの入力候補表示（docs/仕様書.md §3.4）
--
-- カテゴリ本体は引き続き全ユーザー共通で読める。ここで制御するのは新規入力時の候補だけ。
-- 作成時の初期値と、利用者ごとの上書きを分けることで、あとから参加した利用者にも
-- 「自分だけ表示 / 全員表示」の初期値が一貫して適用される。

alter table public.categories
  add column is_visible_to_all boolean not null default true;

comment on column public.categories.is_visible_to_all is
  '入力候補の初期表示。true は全員、false は作成者だけ。参照権限や集計には影響しない';

create table public.category_visibility_preferences (
  category_id uuid not null references public.categories(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_visible boolean not null,
  primary key (category_id, user_id)
);

create index category_visibility_preferences_user_idx
  on public.category_visibility_preferences (user_id, category_id);

comment on table public.category_visibility_preferences is
  '利用者ごとのカテゴリ入力候補表示。行が無ければ categories.is_visible_to_all と作成者から決める';

alter table public.category_visibility_preferences enable row level security;

grant select, insert, update, delete on public.category_visibility_preferences to authenticated;

create policy category_visibility_preferences_select
  on public.category_visibility_preferences
  for select to authenticated
  using (user_id = auth.uid());

create policy category_visibility_preferences_insert
  on public.category_visibility_preferences
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.categories c
       where c.id = category_id and not c.is_system
    )
  );

create policy category_visibility_preferences_update
  on public.category_visibility_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.categories c
       where c.id = category_id and not c.is_system
    )
  );

create policy category_visibility_preferences_delete
  on public.category_visibility_preferences
  for delete to authenticated
  using (user_id = auth.uid());

-- カテゴリ作成時だけ初期表示を指定できる。作成後の個人差は設定表へ置く。
grant insert (is_visible_to_all) on public.categories to authenticated;

