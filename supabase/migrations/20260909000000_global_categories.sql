-- カテゴリを全ユーザー共通にする（docs/仕様書.md §2.4 / §2.8 / §3.4）
--
-- これまではカテゴリが共有範囲を持ち、取引・予算・定期登録ルールはカテゴリをたどって
-- 共有範囲を決めていた。カテゴリを全員共通のマスタにするため、共有範囲の担い手を
-- カテゴリから取引・予算・ルールの側へ移す。
--
-- カテゴリは「何に使ったか」だけを表す全員共通の名前になり、「誰と共有するか」は
-- 記録の側が持つ。同じ「食費」に、夫婦の取引と個人の取引が並ぶ。
--
-- 統合は不可逆（`夫婦 / 食費` と `個人 / 食費` は二度と分けられない）ため、
-- 旧 id → 新 id の対応を private.category_merge_map に残す。

set check_function_bodies = off;

-- ==================================================== 1. 統合の記録

-- 統合前にどの共有範囲のどのカテゴリだったかを残す。private なので PostgREST から見えない。
-- 巻き戻すときは、この表と取引側の共有範囲の列があれば元のカテゴリを再現できる。
create table private.category_merge_map (
  old_id uuid primary key,
  new_id uuid not null,
  old_share_group_id uuid,
  old_owner_id uuid,
  old_parent_id uuid,
  kind text not null,
  name text not null,
  merged_at timestamptz not null default now()
);

comment on table private.category_merge_map is
  'カテゴリ共通化の統合前後の対応。統合は不可逆なので巻き戻しの手がかりとして残す';

revoke all on private.category_merge_map from public, anon, authenticated;

-- ======================================== 2. 共有範囲を記録の側へ移す

alter table public.transactions
  add column share_group_id uuid references public.share_groups (id) on delete restrict,
  add column owner_id uuid references auth.users (id) on delete restrict;

alter table public.budgets
  add column share_group_id uuid references public.share_groups (id) on delete cascade,
  add column owner_id uuid references auth.users (id) on delete cascade;

alter table public.recurring_rules
  add column share_group_id uuid references public.share_groups (id) on delete restrict,
  add column owner_id uuid references auth.users (id) on delete restrict;

comment on column public.transactions.share_group_id is
  '共有範囲。null なら個人（owner_id が入る）。どちらか一方だけが入る';
comment on column public.budgets.share_group_id is '共有範囲。取引と同じ規則';
comment on column public.recurring_rules.share_group_id is '共有範囲。取引と同じ規則';

-- 予算と取引は restrict / cascade を分ける。取引に現れる利用者は削除できない（§3）が、
-- 予算しか持たない利用者は消せてよい。
--
-- バックフィル。今の共有範囲はカテゴリが持っているので、そこから写す。
update public.transactions t
   set share_group_id = c.share_group_id, owner_id = c.owner_id
  from public.categories c where c.id = t.category_id;

update public.budgets b
   set share_group_id = c.share_group_id, owner_id = c.owner_id
  from public.categories c where c.id = b.category_id;

update public.recurring_rules r
   set share_group_id = c.share_group_id, owner_id = c.owner_id
  from public.categories c where c.id = r.category_id;

alter table public.transactions
  add constraint transactions_scope_ck check (num_nonnulls(share_group_id, owner_id) = 1);
alter table public.budgets
  add constraint budgets_scope_ck check (num_nonnulls(share_group_id, owner_id) = 1);
alter table public.recurring_rules
  add constraint recurring_rules_scope_ck check (num_nonnulls(share_group_id, owner_id) = 1);

-- RLS が毎回引く。カテゴリではなくここで絞るようになるため索引を張る
create index transactions_scope_idx on public.transactions (share_group_id, owner_id, occurred_on);
create index budgets_scope_idx on public.budgets (share_group_id, owner_id);
create index recurring_rules_scope_idx on public.recurring_rules (share_group_id, owner_id);

-- ==================================================== 3. カテゴリの統合
--
-- 統合の間だけ、旧トリガを外す。
--  - categories_guard_update は親の付け替えを禁じている（作り直しへ誘導するため）が、
--    ここでの付け替えは統合そのもので、取引の付け替えを伴わない
--  - 支払者の検査は「カテゴリの共有範囲」を見る旧版のまま。カテゴリを寄せると
--    共有範囲が動いたように見えて誤って弾く。正しい共有範囲は 2. で記録側に写してある
alter table public.categories disable trigger categories_guard_update;
alter table public.transactions disable trigger transactions_check_payer_update;
alter table public.recurring_rules disable trigger recurring_rules_check_payer_update;

-- 小分類の一意索引も先に外す。親を寄せた瞬間、統合前の `夫婦 / 食費 / 外食` と
-- `個人 / 食費 / 外食` が同じ親の下に並び、子を寄せる前に衝突するため（5. で張り直す）
drop index public.categories_child_uq;

-- 予算の一意性 (カテゴリ, 対象月) も外す。統合で `夫婦 / 食費` と `個人 / 食費` が
-- 同じカテゴリになると、対象月の同じ枠が3つ同居して衝突する。
-- 共有範囲を含めた一意性は 5. で張り直す（最終形では夫婦の枠と個人の枠は別行として共存する）
alter table public.budgets drop constraint budgets_category_month_uq;


-- 大分類。(kind, name) が同じものを1つに寄せる。残すのは最も古い1件。
-- 未分類（is_system）は name が '未分類' で、どの共有範囲にも1件ずつあるため
-- このまとめ方で収支区分ごとに1件へ寄る（利用者が '未分類' を作ることはできない。
-- どの共有範囲にも同名の未分類が先にいて一意制約に当たるため）。
with survivor as (
  select distinct on (c.kind, c.name) c.id, c.kind, c.name
    from public.categories c
   where c.parent_id is null
   order by c.kind, c.name, c.created_at, c.id
)
insert into private.category_merge_map
  (old_id, new_id, old_share_group_id, old_owner_id, old_parent_id, kind, name)
select c.id, s.id, c.share_group_id, c.owner_id, c.parent_id, c.kind, c.name
  from public.categories c
  join survivor s on s.kind = c.kind and s.name = c.name
 where c.parent_id is null and c.id <> s.id;

-- 小分類の親を、統合後の親へ付け替える。ここを先にしないと (親, 名前) で寄せられない
update public.categories c
   set parent_id = m.new_id
  from private.category_merge_map m
 where c.parent_id = m.old_id;

-- 小分類。付け替え後の (親, 名前) が同じものを1つに寄せる
with survivor as (
  select distinct on (c.parent_id, c.name) c.id, c.parent_id, c.name
    from public.categories c
   where c.parent_id is not null
   order by c.parent_id, c.name, c.created_at, c.id
)
insert into private.category_merge_map
  (old_id, new_id, old_share_group_id, old_owner_id, old_parent_id, kind, name)
select c.id, s.id, c.share_group_id, c.owner_id, c.parent_id, c.kind, c.name
  from public.categories c
  join survivor s on s.parent_id = c.parent_id and s.name = c.name
 where c.parent_id is not null and c.id <> s.id;

-- 参照の張り替え。共有範囲は 2. で記録の側へ写してあるので、ここで失われるものはない
update public.transactions t set category_id = m.new_id
  from private.category_merge_map m where t.category_id = m.old_id;

update public.recurring_rules r set category_id = m.new_id
  from private.category_merge_map m where r.category_id = m.old_id;

update public.budgets b set category_id = m.new_id
  from private.category_merge_map m where b.category_id = m.old_id;

update public.profiles p set default_category_id = m.new_id
  from private.category_merge_map m where p.default_category_id = m.old_id;

delete from public.categories c
 where exists (select 1 from private.category_merge_map m where m.old_id = c.id);

alter table public.categories enable trigger categories_guard_update;
alter table public.transactions enable trigger transactions_check_payer_update;
alter table public.recurring_rules enable trigger recurring_rules_check_payer_update;

-- ================== 4. 古いポリシーと関数を落とす
--
-- 共有範囲の列を落とす前に、その列を参照しているポリシーを外す。
--
-- accessible_category_ids() を参照しているポリシーを先に落とさないと関数を落とせない。

drop policy categories_select on public.categories;
drop policy categories_insert on public.categories;
drop policy categories_update on public.categories;
drop policy transactions_select on public.transactions;
drop policy transactions_update on public.transactions;
drop policy transactions_delete on public.transactions;
drop policy transaction_splits_select on public.transaction_splits;
drop policy budgets_select on public.budgets;
drop policy budgets_insert on public.budgets;
drop policy budgets_update on public.budgets;
drop policy budgets_delete on public.budgets;
drop policy recurring_rules_select on public.recurring_rules;
drop policy recurring_rules_delete on public.recurring_rules;
drop policy recurring_rule_splits_select on public.recurring_rule_splits;
drop policy recurring_postings_select on public.recurring_postings;

-- カテゴリは全員が見られるようになったので、この2本は意味を失う
drop function private.accessible_category_ids();
drop function private.can_user_access_category(uuid, uuid);
drop function public.assert_category_accessible(uuid);
drop function public.move_category_scope(uuid, uuid, uuid, boolean);
drop function public.default_splits(uuid, int, uuid);

-- =============================== 5. カテゴリから共有範囲の列を落とす

alter table public.categories drop constraint categories_scope_ck;

drop index public.categories_group_uq;
drop index public.categories_own_uq;
drop index public.categories_sys_group_uq;
drop index public.categories_sys_own_uq;

alter table public.categories
  drop column share_group_id,
  drop column owner_id;

-- 大分類は全体で一意。小分類は同じ親の中で一意
create unique index categories_root_uq
  on public.categories (kind, name)
  where parent_id is null;

-- 未分類は収支区分ごとに1つ
create unique index categories_sys_uq
  on public.categories (kind)
  where is_system;

-- 3. で外した小分類の一意索引を張り直す（定義は据え置き）
create unique index categories_child_uq
  on public.categories (parent_id, name)
  where parent_id is not null;

comment on table public.categories is
  '取引の分類。全ユーザー共通のマスタで、共有範囲は持たない（共有範囲は取引・予算・ルールの側）';

-- 3. で外した予算の一意性を、共有範囲込みで張り直す。
-- 単一の unique では NULL 同士が衝突せず発火しないので、部分一意索引に分ける（§3）
create unique index budgets_group_month_uq
  on public.budgets (category_id, share_group_id, month)
  where share_group_id is not null;

create unique index budgets_own_month_uq
  on public.budgets (category_id, owner_id, month)
  where owner_id is not null;

-- ==================================================== 7. 判定関数

-- 防壁がカテゴリから共有範囲そのものへ移る。行ごとに関数を呼ぶと取引の行数だけ
-- 呼び出しが起きるため、グループ id の集合を返して `in (select ...)` に畳む（§2.6）
create or replace function private.accessible_group_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.share_group_id from public.share_group_members m where m.user_id = auth.uid();
$$;

-- 単一の行・引数の組を判定する側（RPC とトリガから呼ぶ）
create or replace function private.can_access_scope(p_share_group_id uuid, p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_share_group_id is null
              then p_owner_id = auth.uid()
              else private.is_group_member(p_share_group_id)
         end;
$$;

revoke all on function private.accessible_group_ids() from public, anon;
revoke all on function private.can_access_scope(uuid, uuid) from public, anon;
grant execute on function private.accessible_group_ids() to authenticated;
grant execute on function private.can_access_scope(uuid, uuid) to authenticated;

-- ==================================================== 8. トリガの入れ替え

-- カテゴリ。共有範囲を持たなくなったので、親から写すのは収支区分だけ
create or replace function public.categories_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.categories%rowtype;
begin
  if new.parent_id is not null then
    select * into v_parent from public.categories c where c.id = new.parent_id;
    if not found then
      raise exception '親カテゴリが見つかりません';
    end if;
    if v_parent.parent_id is not null then
      raise exception '小分類の下にカテゴリは作れません（階層は2段までです）';
    end if;
    if v_parent.is_system then
      raise exception '未分類の下にカテゴリは作れません';
    end if;
    new.kind := v_parent.kind;
  end if;
  return new;
end;
$$;

-- 改名は禁じない。全員共通のマスタなので誰が直してもよく、誤字直しと意味の付け替えを
-- 機械的に見分ける方法もない。影響（他の利用者の取引が何件そのカテゴリを指しているか）は
-- category_usage() で数え、画面が保存前に見せて確かめる（§3.4）。
-- 取り返しがつかないのは削除の方なので、そちらを delete_category() で縛る。
create or replace function public.categories_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind then
    raise exception '収支区分は変更できません。別のカテゴリを作って取引を付け替えてください';
  end if;
  if new.parent_id is distinct from old.parent_id then
    raise exception '親カテゴリは変更できません。作り直して取引を付け替えてください';
  end if;
  if new.is_system is distinct from old.is_system then
    raise exception '未分類かどうかは変更できません';
  end if;
  if old.is_system then
    if new.name is distinct from old.name then
      raise exception '未分類カテゴリは改名できません';
    end if;
    if new.is_archived is distinct from old.is_archived then
      raise exception '未分類カテゴリはアーカイブできません';
    end if;
  end if;
  return new;
end;
$$;

-- 支払者。共有範囲は取引・ルール自身の列から読む（カテゴリはもう持っていない）
create or replace function public.transactions_check_payer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.share_group_id is null then
    -- 個人。null（共用）を通すと、update だけで個人の取引を共用にできてしまう
    if new.payer_id is distinct from new.owner_id then
      raise exception '個人の取引の支払者は本人だけです';
    end if;
  elsif new.payer_id is not null
        and not private.is_group_member_of(new.share_group_id, new.payer_id) then
    raise exception '支払者がその共有グループのメンバーではありません';
  end if;
  return new;
end;
$$;

-- 共有範囲が列になったので、発火の条件も張り直す
drop trigger transactions_check_payer_update on public.transactions;
create trigger transactions_check_payer_update
  before update of payer_id, share_group_id, owner_id on public.transactions
  for each row
  when (old.payer_id is distinct from new.payer_id
        or old.share_group_id is distinct from new.share_group_id
        or old.owner_id is distinct from new.owner_id)
  execute function public.transactions_check_payer();

drop trigger recurring_rules_check_payer_update on public.recurring_rules;
create trigger recurring_rules_check_payer_update
  before update of payer_id, share_group_id, owner_id on public.recurring_rules
  for each row
  when (old.payer_id is distinct from new.payer_id
        or old.share_group_id is distinct from new.share_group_id
        or old.owner_id is distinct from new.owner_id)
  execute function public.transactions_check_payer();

create or replace function public.splits_check_member()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_group uuid;
  v_owner uuid;
begin
  select t.share_group_id, t.owner_id into v_group, v_owner
    from public.transactions t where t.id = new.transaction_id;

  if v_group is null then
    -- 個人の共有範囲のメンバーは所有者1人だけ
    if new.user_id is distinct from v_owner then
      raise exception '個人の取引の負担は本人だけです';
    end if;
  elsif not private.is_group_member_of(v_group, new.user_id) then
    raise exception '負担の相手がその共有グループのメンバーではありません';
  end if;
  return new;
end;
$$;

create or replace function public.recurring_rule_splits_check_member()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_group uuid;
  v_owner uuid;
begin
  select r.share_group_id, r.owner_id into v_group, v_owner
    from public.recurring_rules r where r.id = new.rule_id;

  if v_group is null then
    if new.user_id is distinct from v_owner then
      raise exception '個人の取引の負担は本人だけです';
    end if;
  elsif not private.is_group_member_of(v_group, new.user_id) then
    raise exception '負担の相手がその共有グループのメンバーではありません';
  end if;
  return new;
end;
$$;

-- 既定カテゴリ。全員が全カテゴリを見られるので、残る検査はアーカイブ済みかどうかだけ
create or replace function public.profiles_check_default_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.default_category_id is not null then
    if not exists (
      select 1 from public.categories c
       where c.id = new.default_category_id and not c.is_archived
    ) then
      raise exception 'そのカテゴリは既定にできません';
    end if;
  end if;
  return new;
end;
$$;

-- 利用者を作っても、もう個人用の未分類は要らない（未分類は全体で2件）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_name text;
  v_n int := 1;
begin
  v_base := btrim(regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[:;[:cntrl:]]', '', 'g'));
  if v_base = '' or v_base in ('共用', '個人') then
    v_base := '利用者';
  end if;

  v_name := v_base;
  while exists (select 1 from public.profiles p where p.display_name = v_name) loop
    v_n := v_n + 1;
    v_name := v_base || '-' || v_n;
  end loop;

  insert into public.profiles (id, display_name) values (new.id, v_name);
  return new;
end;
$$;

-- ------------------------------------------ 全体共通の未分類をそろえる
--
-- カテゴリのトリガを入れ替えた後に行う。旧トリガは new.share_group_id を読むため

-- 統合を経た DB では収支区分ごとに1件へ寄っている。新規の DB には1件も無いので作る。
-- created_by は入れない（作成者のいないシステム行。FK は set null を許している）
insert into public.categories (kind, name, is_system, sort_order)
select v.kind, '未分類', true, 9999
  from (values ('expense'), ('income')) as v (kind)
 where not exists (
   select 1 from public.categories c where c.is_system and c.kind = v.kind
 );

-- ============================ 9. RLS ポリシーとテーブル権限（§2.6）

-- カテゴリ。全員が見て、作って、直せる共通のマスタ。削除だけ RPC に閉じる
grant select on public.categories to authenticated;
revoke insert on public.categories from authenticated;
revoke update on public.categories from authenticated;
grant insert (kind, name, color, sort_order, parent_id) on public.categories to authenticated;
grant update (name, color, sort_order, is_archived) on public.categories to authenticated;

create policy categories_select on public.categories
  for select to authenticated using (true);

create policy categories_insert on public.categories
  for insert to authenticated with check (created_by = auth.uid());

create policy categories_update on public.categories
  for update to authenticated using (true) with check (true);

-- 取引。カテゴリ経由ではなく自分の共有範囲の列で絞る
create policy transactions_select on public.transactions
  for select to authenticated
  using (owner_id = auth.uid() or share_group_id in (select private.accessible_group_ids()));

create policy transactions_update on public.transactions
  for update to authenticated
  using (owner_id = auth.uid() or share_group_id in (select private.accessible_group_ids()))
  with check (owner_id = auth.uid() or share_group_id in (select private.accessible_group_ids()));

create policy transactions_delete on public.transactions
  for delete to authenticated
  using (owner_id = auth.uid() or share_group_id in (select private.accessible_group_ids()));

create policy transaction_splits_select on public.transaction_splits
  for select to authenticated
  using (
    exists (
      select 1 from public.transactions t
      where t.id = transaction_id
        and (t.owner_id = auth.uid()
             or t.share_group_id in (select private.accessible_group_ids()))
    )
  );

-- 予算。共有範囲の列が増えたので INSERT の許可列も足す
revoke insert on public.budgets from authenticated;
grant insert (category_id, share_group_id, owner_id, month, amount) on public.budgets to authenticated;

create policy budgets_select on public.budgets
  for select to authenticated
  using (owner_id = auth.uid() or share_group_id in (select private.accessible_group_ids()));

create policy budgets_insert on public.budgets
  for insert to authenticated
  with check (owner_id = auth.uid() or share_group_id in (select private.accessible_group_ids()));

create policy budgets_update on public.budgets
  for update to authenticated
  using (owner_id = auth.uid() or share_group_id in (select private.accessible_group_ids()))
  with check (owner_id = auth.uid() or share_group_id in (select private.accessible_group_ids()));

create policy budgets_delete on public.budgets
  for delete to authenticated
  using (owner_id = auth.uid() or share_group_id in (select private.accessible_group_ids()));

create policy recurring_rules_select on public.recurring_rules
  for select to authenticated
  using (owner_id = auth.uid() or share_group_id in (select private.accessible_group_ids()));

create policy recurring_rules_delete on public.recurring_rules
  for delete to authenticated
  using (owner_id = auth.uid() or share_group_id in (select private.accessible_group_ids()));

create policy recurring_rule_splits_select on public.recurring_rule_splits
  for select to authenticated
  using (
    exists (
      select 1 from public.recurring_rules r
      where r.id = rule_id
        and (r.owner_id = auth.uid()
             or r.share_group_id in (select private.accessible_group_ids()))
    )
  );

create policy recurring_postings_select on public.recurring_postings
  for select to authenticated
  using (
    exists (
      select 1 from public.recurring_rules r
      where r.id = rule_id
        and (r.owner_id = auth.uid()
             or r.share_group_id in (select private.accessible_group_ids()))
    )
  );

-- ==================================================== 10. RPC の書き換え

-- 共有範囲を引数で受け取る形へ。カテゴリからは収支区分だけを読む（§5.1）
create or replace function public.default_splits(
  p_share_group_id uuid,
  p_owner_id uuid,
  p_kind text,
  p_amount int,
  p_payer_id uuid
)
returns table (user_id uuid, amount int)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_weight_sum bigint;
begin
  -- 個人は本人が全額
  if p_share_group_id is null then
    return query select p_owner_id, p_amount;
    return;
  end if;

  -- 収入は受け取った本人 100%。支出用の重みを取り分に流用しない
  if p_kind = 'income' and p_payer_id is not null then
    return query select p_payer_id, p_amount;
    return;
  end if;

  select coalesce(sum(m.default_weight), 0) into v_weight_sum
    from public.share_group_members m
   where m.share_group_id = p_share_group_id and m.default_weight > 0;

  if v_weight_sum = 0 and p_payer_id is not null then
    return query select p_payer_id, p_amount;
    return;
  end if;

  return query
  with m as (
    select
      sgm.user_id,
      case when v_weight_sum = 0 then 1 else sgm.default_weight end as weight,
      sgm.sort_order
    from public.share_group_members sgm
    where sgm.share_group_id = p_share_group_id
      and (v_weight_sum = 0 or sgm.default_weight > 0)
  ),
  w as (select sum(m.weight)::bigint as total from m),
  base as (
    select
      m.user_id,
      (p_amount::bigint * m.weight / w.total)::int as base_amount,
      row_number() over (order by m.weight desc, m.sort_order, m.user_id) as rn
    from m cross join w
  )
  select
    base.user_id,
    (base.base_amount
      + case when base.rn <= p_amount - sum(base.base_amount) over () then 1 else 0 end)::int
  from base;
end;
$$;

-- 共有範囲が参照できることの検査。カテゴリではなく共有範囲に対して行う
create or replace function public.assert_scope_accessible(
  p_share_group_id uuid,
  p_owner_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if num_nonnulls(p_share_group_id, p_owner_id) <> 1 then
    raise exception '共有範囲を1つだけ指定してください';
  end if;
  if not private.can_access_scope(p_share_group_id, p_owner_id) then
    raise exception 'その共有範囲は使えません';
  end if;
end;
$$;

-- カテゴリは全員が参照できる。残る検査は「実在すること」だけ
create or replace function public.assert_category_exists(p_category_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (select 1 from public.categories c where c.id = p_category_id) then
    raise exception 'カテゴリが見つかりません';
  end if;
end;
$$;

create or replace function public.rebuild_splits(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
  v_owner uuid;
  v_kind text;
  v_amount int;
  v_payer uuid;
begin
  select t.share_group_id, t.owner_id, c.kind, t.amount, t.payer_id
    into v_group, v_owner, v_kind, v_amount, v_payer
    from public.transactions t
    join public.categories c on c.id = t.category_id
   where t.id = p_transaction_id;

  delete from public.transaction_splits s where s.transaction_id = p_transaction_id;
  insert into public.transaction_splits (transaction_id, user_id, amount)
  select p_transaction_id, d.user_id, d.amount
    from public.default_splits(v_group, v_owner, v_kind, v_amount, v_payer) d
   where d.amount >= 0;

  update public.transactions t set splits_are_manual = false where t.id = p_transaction_id;
end;
$$;

-- ---------------------------------------------------------------- 取引

-- 共有範囲を引数に取る。既定は無い。省略を「自分の個人」と読むと、共有のつもりの
-- 入力が黙って個人に落ちる
create or replace function public.upsert_transaction(
  p_category_id uuid,
  p_occurred_on date,
  p_amount int,
  p_payer_id uuid default null,
  p_memo text default '',
  p_splits jsonb default null,
  p_id uuid default null,
  p_share_group_id uuid default null,
  p_owner_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_uid();
  v_id uuid;
  v_old_group uuid;
  v_old_owner uuid;
  v_found boolean;
  v_kind text;
  v_manual boolean := p_splits is not null;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception '金額は1以上の整数にしてください';
  end if;
  perform public.assert_category_exists(p_category_id);
  perform public.assert_scope_accessible(p_share_group_id, p_owner_id);

  select c.kind into v_kind from public.categories c where c.id = p_category_id;

  if p_id is not null then
    select true, t.share_group_id, t.owner_id into v_found, v_old_group, v_old_owner
      from public.transactions t where t.id = p_id;
    if not coalesce(v_found, false) then
      raise exception '取引が見つかりません';
    end if;
    -- 移動元も参照できないと、他人の取引を自分の側へ引き寄せられる
    perform public.assert_scope_accessible(v_old_group, v_old_owner);
  end if;

  if v_manual then
    if jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 0 then
      raise exception '負担の指定が不正です';
    end if;
    if exists (select 1 from jsonb_array_elements(p_splits) e where (e->>'amount')::int < 0) then
      raise exception '負担額は0以上にしてください';
    end if;
    if (select count(distinct (e->>'user_id')::uuid) from jsonb_array_elements(p_splits) e)
       <> jsonb_array_length(p_splits) then
      raise exception '同じ人が負担に2回現れています';
    end if;
    if (select coalesce(sum((e->>'amount')::int), -1) from jsonb_array_elements(p_splits) e)
       <> p_amount then
      raise exception '負担の合計が金額と一致しません';
    end if;
  end if;

  if p_id is null then
    insert into public.transactions
      (category_id, share_group_id, owner_id, payer_id, created_by,
       occurred_on, amount, memo, splits_are_manual)
    values
      (p_category_id, p_share_group_id, p_owner_id, p_payer_id, v_uid,
       p_occurred_on, p_amount, coalesce(p_memo, ''), v_manual)
    returning id into v_id;
  else
    update public.transactions t
       set category_id = p_category_id,
           share_group_id = p_share_group_id,
           owner_id = p_owner_id,
           payer_id = p_payer_id,
           occurred_on = p_occurred_on,
           amount = p_amount,
           memo = coalesce(p_memo, ''),
           splits_are_manual = v_manual
     where t.id = p_id
    returning t.id into v_id;
  end if;

  delete from public.transaction_splits s where s.transaction_id = v_id;

  if v_manual then
    insert into public.transaction_splits (transaction_id, user_id, amount)
    select v_id, (e->>'user_id')::uuid, (e->>'amount')::int
      from jsonb_array_elements(p_splits) e;
  else
    insert into public.transaction_splits (transaction_id, user_id, amount)
    select v_id, d.user_id, d.amount
      from public.default_splits(p_share_group_id, p_owner_id, v_kind, p_amount, p_payer_id) d;
  end if;

  perform public.assert_splits_balanced(v_id);
  return v_id;
end;
$$;

drop function public.upsert_transaction(uuid, date, int, uuid, text, jsonb, uuid);

create or replace function public.import_transactions(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_count int := 0;
begin
  perform public.require_uid();
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception '取り込む行がありません';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    perform public.upsert_transaction(
      p_category_id => (v_row->>'category_id')::uuid,
      p_occurred_on => (v_row->>'occurred_on')::date,
      p_amount => (v_row->>'amount')::int,
      p_payer_id => nullif(v_row->>'payer_id', '')::uuid,
      p_memo => coalesce(v_row->>'memo', ''),
      p_splits => v_row->'splits',
      p_share_group_id => nullif(v_row->>'share_group_id', '')::uuid,
      p_owner_id => nullif(v_row->>'owner_id', '')::uuid
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('inserted', v_count);
end;
$$;

-- ------------------------------------------------------------- カテゴリ

-- 改名・削除の前に画面が見せる影響（§3.4）。RLS では他人の個人範囲の行が見えないので
-- DEFINER で数える。返すのは件数だけで、中身は返さない
create or replace function public.category_usage(p_category_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_uid();
  v_ids uuid[];
begin
  perform public.assert_category_exists(p_category_id);

  -- 小分類を持つ大分類なら、配下の分も影響に含める
  select array_agg(c.id) into v_ids from public.categories c
   where c.id = p_category_id or c.parent_id = p_category_id;

  return jsonb_build_object(
    'transactions',
      (select count(*) from public.transactions t where t.category_id = any (v_ids)),
    'others_transactions',
      (select count(*) from public.transactions t
        where t.category_id = any (v_ids) and t.created_by <> v_uid),
    'rules',
      (select count(*) from public.recurring_rules r where r.category_id = any (v_ids)),
    'others_rules',
      (select count(*) from public.recurring_rules r
        where r.category_id = any (v_ids) and r.created_by <> v_uid),
    'budgets',
      (select count(*) from public.budgets b where b.category_id = any (v_ids)),
    'others_budgets',
      (select count(*) from public.budgets b
        where b.category_id = any (v_ids)
          and not private.can_access_scope(b.share_group_id, b.owner_id)),
    'others',
      (select count(distinct t.created_by) from public.transactions t
        where t.category_id = any (v_ids) and t.created_by <> v_uid)
  );
end;
$$;

-- 削除は取り返しがつかない（他人の取引が黙って未分類へ移り、他人の予算が消える）。
-- 自分以外が使っているカテゴリは消させず、アーカイブへ誘導する（§3.4）
create or replace function public.delete_category(p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_uid();
  v_kind text;
  v_is_system boolean;
  v_parent uuid;
  v_fallback uuid;
  v_others int;
begin
  perform public.assert_category_exists(p_category_id);

  select c.kind, c.is_system, c.parent_id into v_kind, v_is_system, v_parent
    from public.categories c where c.id = p_category_id;

  if v_is_system then
    raise exception '未分類カテゴリは削除できません';
  end if;

  if v_parent is null
     and exists (select 1 from public.categories c where c.parent_id = p_category_id) then
    raise exception '小分類が残っています。先に小分類を削除してください';
  end if;

  -- 自分以外の取引・ルール
  select (select count(*) from public.transactions t
           where t.category_id = p_category_id and t.created_by <> v_uid)
       + (select count(*) from public.recurring_rules r
           where r.category_id = p_category_id and r.created_by <> v_uid)
    into v_others;
  if v_others > 0 then
    raise exception '他の人が使っているカテゴリは削除できません（% 件）。アーカイブしてください', v_others;
  end if;
  -- 自分から見えない共有範囲の予算
  if exists (
    select 1 from public.budgets b
     where b.category_id = p_category_id
       and not private.can_access_scope(b.share_group_id, b.owner_id)
  ) then
    raise exception '他の人が予算を置いているカテゴリは削除できません。アーカイブしてください';
  end if;

  -- 移動先は、小分類なら親、大分類なら未分類
  if v_parent is not null then
    v_fallback := v_parent;
  else
    select c.id into v_fallback from public.categories c
     where c.is_system and c.kind = v_kind;
    if v_fallback is null then
      raise exception '未分類カテゴリが見つかりません';
    end if;
  end if;

  -- 共有範囲は取引・ルールの側に残るので、負担も雛形も作り直さない
  update public.transactions t set category_id = v_fallback where t.category_id = p_category_id;
  update public.recurring_rules r set category_id = v_fallback where r.category_id = p_category_id;
  delete from public.budgets b where b.category_id = p_category_id;
  delete from public.categories c where c.id = p_category_id;
end;
$$;

-- ----------------------------------------------------------- 共有グループ

-- グループごとの未分類はもう無い。カテゴリの検査も要らない（カテゴリは共通）
create or replace function public.create_share_group(p_name text, p_members jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_uid();
  v_gid uuid;
  v_member jsonb;
begin
  if p_members is null or jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) = 0 then
    raise exception 'メンバーを指定してください';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_members) e where (e->>'user_id')::uuid = v_uid
  ) then
    raise exception '自分自身をメンバーに含めてください';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_members) e
    where not exists (select 1 from public.profiles p where p.id = (e->>'user_id')::uuid)
  ) then
    raise exception '存在しない利用者が含まれています';
  end if;

  insert into public.share_groups (name, created_by) values (p_name, v_uid) returning id into v_gid;

  for v_member in select * from jsonb_array_elements(p_members) loop
    insert into public.share_group_members (share_group_id, user_id, default_weight, sort_order)
    values (
      v_gid,
      (v_member->>'user_id')::uuid,
      coalesce((v_member->>'default_weight')::int, 1),
      coalesce((v_member->>'sort_order')::int, 0)
    );
  end loop;

  return v_gid;
end;
$$;

create or replace function public.delete_share_group(p_share_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_uid();
  if not private.is_group_member(p_share_group_id) then
    raise exception 'そのグループのメンバーではありません';
  end if;
  if exists (
    select 1 from public.transactions t where t.share_group_id = p_share_group_id
  ) then
    raise exception '取引が残っているグループは削除できません';
  end if;
  if exists (
    select 1 from public.recurring_rules r where r.share_group_id = p_share_group_id
  ) then
    raise exception '定期登録ルールが残っているグループは削除できません';
  end if;

  -- メンバーと予算はカスケードで消える
  delete from public.share_groups g where g.id = p_share_group_id;
end;
$$;

-- ------------------------------------------------------- 共有範囲の変更
--
-- カテゴリはもう共有範囲を持たないので、move_category_scope() は無くなった。
-- 残る経路は2つ。取引のカテゴリを替える（共有範囲は動かない）か、
-- 取引の共有範囲を替える（カテゴリは動かない）か。

create or replace function public.assert_move_allowed(
  p_transaction_ids uuid[],
  p_dest_group uuid,
  p_dest_owner uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bad int;
begin
  if p_dest_group is null then
    -- 移動先が個人なら、他人の支払い・他人の負担が混ざっていてはいけない
    select count(*) into v_bad from public.transactions t
     where t.id = any (p_transaction_ids)
       and (t.payer_id is distinct from p_dest_owner
            or exists (select 1 from public.transaction_splits s
                        where s.transaction_id = t.id and s.user_id <> p_dest_owner));
    if v_bad > 0 then
      raise exception '他の人が支払った、または負担している取引が % 件あります', v_bad;
    end if;
  else
    -- 支払者が「共用」の取引は共有から共有への移動では許す
    select count(*) into v_bad from public.transactions t
     where t.id = any (p_transaction_ids)
       and t.payer_id is not null
       and not private.is_group_member_of(p_dest_group, t.payer_id);
    if v_bad > 0 then
      raise exception '移動先グループのメンバーでない人が支払った取引が % 件あります', v_bad;
    end if;
  end if;
end;
$$;

-- カテゴリの付け替え。共有範囲は動かないので負担は作り直さない
create or replace function public.move_transactions(
  p_transaction_ids uuid[],
  p_dest_category_id uuid
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  perform public.require_uid();
  perform public.assert_category_exists(p_dest_category_id);

  if exists (
    select 1 from public.transactions t
     where t.id = any (p_transaction_ids)
       and not private.can_access_scope(t.share_group_id, t.owner_id)
  ) then
    raise exception '参照できない取引が含まれています';
  end if;

  update public.transactions t set category_id = p_dest_category_id
   where t.id = any (p_transaction_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 共有範囲の付け替え。カテゴリは動かない。範囲が変わる取引だけ負担を作り直す（§5.2）
create or replace function public.move_transactions_scope(
  p_transaction_ids uuid[],
  p_dest_share_group_id uuid default null,
  p_dest_owner_id uuid default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx uuid;
  v_count int := 0;
  v_scope_changed boolean;
begin
  perform public.require_uid();
  perform public.assert_scope_accessible(p_dest_share_group_id, p_dest_owner_id);

  if exists (
    select 1 from public.transactions t
     where t.id = any (p_transaction_ids)
       and not private.can_access_scope(t.share_group_id, t.owner_id)
  ) then
    raise exception '参照できない取引が含まれています';
  end if;

  perform public.assert_move_allowed(p_transaction_ids, p_dest_share_group_id, p_dest_owner_id);

  foreach v_tx in array p_transaction_ids loop
    select (t.share_group_id is distinct from p_dest_share_group_id)
        or (t.owner_id is distinct from p_dest_owner_id)
      into v_scope_changed
      from public.transactions t where t.id = v_tx;

    update public.transactions t
       set share_group_id = p_dest_share_group_id, owner_id = p_dest_owner_id
     where t.id = v_tx;

    if v_scope_changed then
      perform public.rebuild_splits(v_tx);
      perform public.assert_splits_balanced(v_tx);
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ------------------------------------------------------------- 定期登録

create or replace function public.upsert_recurring_rule(
  p_category_id uuid,
  p_amount int,
  p_day_of_month int,
  p_start_month date,
  p_payer_id uuid default null,
  p_memo text default '',
  p_end_month date default null,
  p_is_paused boolean default false,
  p_splits jsonb default null,
  p_id uuid default null,
  p_share_group_id uuid default null,
  p_owner_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_old_group uuid;
  v_old_owner uuid;
  v_found boolean;
  v_manual boolean := p_splits is not null;
  v_start date := date_trunc('month', p_start_month)::date;
  v_end date := case when p_end_month is null then null
                     else date_trunc('month', p_end_month)::date end;
begin
  perform public.require_uid();

  if p_amount is null or p_amount <= 0 then
    raise exception '金額は1以上の整数にしてください';
  end if;
  if p_day_of_month is null or p_day_of_month < 1 or p_day_of_month > 31 then
    raise exception '支払日は1〜31の日にしてください';
  end if;
  if v_start is null then
    raise exception '開始月を指定してください';
  end if;
  if v_end is not null and v_end < v_start then
    raise exception '終了月は開始月以降にしてください';
  end if;

  perform public.assert_category_exists(p_category_id);
  perform public.assert_scope_accessible(p_share_group_id, p_owner_id);

  if p_id is not null then
    select true, r.share_group_id, r.owner_id into v_found, v_old_group, v_old_owner
      from public.recurring_rules r where r.id = p_id;
    if not coalesce(v_found, false) then
      raise exception '定期登録ルールが見つかりません';
    end if;
    perform public.assert_scope_accessible(v_old_group, v_old_owner);
  end if;

  if v_manual then
    if jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 0 then
      raise exception '負担の指定が不正です';
    end if;
    if exists (select 1 from jsonb_array_elements(p_splits) e where (e->>'amount')::int < 0) then
      raise exception '負担額は0以上にしてください';
    end if;
    if (select count(distinct (e->>'user_id')::uuid) from jsonb_array_elements(p_splits) e)
       <> jsonb_array_length(p_splits) then
      raise exception '同じ人が負担に2回現れています';
    end if;
    if (select coalesce(sum((e->>'amount')::int), -1) from jsonb_array_elements(p_splits) e)
       <> p_amount then
      raise exception '負担の合計が金額と一致しません';
    end if;
  end if;

  if p_id is null then
    insert into public.recurring_rules
      (category_id, share_group_id, owner_id, payer_id, amount, day_of_month, memo,
       start_month, end_month, is_paused, splits_are_manual)
    values
      (p_category_id, p_share_group_id, p_owner_id, p_payer_id, p_amount, p_day_of_month,
       coalesce(p_memo, ''), v_start, v_end, coalesce(p_is_paused, false), v_manual)
    returning id into v_id;
  else
    update public.recurring_rules r
       set category_id = p_category_id,
           share_group_id = p_share_group_id,
           owner_id = p_owner_id,
           payer_id = p_payer_id,
           amount = p_amount,
           day_of_month = p_day_of_month,
           memo = coalesce(p_memo, ''),
           start_month = v_start,
           end_month = v_end,
           is_paused = coalesce(p_is_paused, false),
           splits_are_manual = v_manual
     where r.id = p_id
    returning r.id into v_id;
  end if;

  delete from public.recurring_rule_splits s where s.rule_id = v_id;

  if v_manual then
    insert into public.recurring_rule_splits (rule_id, user_id, amount)
    select v_id, (e->>'user_id')::uuid, (e->>'amount')::int
      from jsonb_array_elements(p_splits) e;
  end if;

  return v_id;
end;
$$;

drop function public.upsert_recurring_rule(uuid, int, int, date, uuid, text, date, boolean, jsonb, uuid);

create or replace function public.run_recurring_rules(p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_rule record;
  v_month date;
  v_last date;
  v_due date;
  v_splits jsonb;
  v_tx uuid;
  v_claimed uuid;
  v_created int := 0;
  v_failed int := 0;
  v_failures jsonb := '[]'::jsonb;
begin
  perform public.require_uid();
  v_today := least(coalesce(p_today, current_date), current_date);
  v_last := date_trunc('month', v_today)::date;

  -- 参照できる共有範囲の、止まっていないルールだけ。
  -- アーカイブ済みカテゴリのルールは動かさない（画面が警告として出す）
  for v_rule in
    select r.*
      from public.recurring_rules r
      join public.categories c on c.id = r.category_id
     where not r.is_paused
       and not c.is_archived
       and (r.owner_id = auth.uid()
            or r.share_group_id in (select private.accessible_group_ids()))
     order by r.created_at, r.id
  loop
    v_month := v_rule.start_month;

    while v_month <= v_last loop
      exit when v_rule.end_month is not null and v_month > v_rule.end_month;
      v_due := private.recurring_due_date(v_month, v_rule.day_of_month);
      exit when v_due > v_today;

      begin
        insert into public.recurring_postings (rule_id, month)
        values (v_rule.id, v_month)
        on conflict do nothing
        returning rule_id into v_claimed;

        if v_claimed is not null then
          if v_rule.splits_are_manual then
            select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'amount', s.amount))
              into v_splits
              from public.recurring_rule_splits s where s.rule_id = v_rule.id;
          else
            v_splits := null;
          end if;

          v_tx := public.upsert_transaction(
            p_category_id => v_rule.category_id,
            p_occurred_on => v_due,
            p_amount => v_rule.amount,
            p_payer_id => v_rule.payer_id,
            p_memo => v_rule.memo,
            p_splits => v_splits,
            p_share_group_id => v_rule.share_group_id,
            p_owner_id => v_rule.owner_id
          );
          -- §2.7 の例外。実行した人ではなくルールを作った人の入力として残す
          update public.transactions t set created_by = v_rule.created_by where t.id = v_tx;
          update public.recurring_postings p set transaction_id = v_tx
           where p.rule_id = v_rule.id and p.month = v_month;

          v_created := v_created + 1;
        end if;
      exception when others then
        v_failed := v_failed + 1;
        v_failures := v_failures || jsonb_build_object(
          'rule_id', v_rule.id, 'month', to_char(v_month, 'YYYY-MM'), 'message', sqlerrm
        );
        exit;
      end;

      v_month := (v_month + interval '1 month')::date;
    end loop;
  end loop;

  return jsonb_build_object('created', v_created, 'failed', v_failed, 'failures', v_failures);
end;
$$;

-- ==================================================== 11. 実行権限（§2.5）

revoke all on function public.default_splits(uuid, uuid, text, int, uuid) from public, anon, authenticated;
revoke all on function public.assert_scope_accessible(uuid, uuid) from public, anon, authenticated;
revoke all on function public.assert_category_exists(uuid) from public, anon, authenticated;
revoke all on function public.rebuild_splits(uuid) from public, anon, authenticated;
revoke all on function public.assert_move_allowed(uuid[], uuid, uuid) from public, anon, authenticated;

revoke all on function public.upsert_transaction(uuid, date, int, uuid, text, jsonb, uuid, uuid, uuid)
  from public, anon;
revoke all on function
  public.upsert_recurring_rule(uuid, int, int, date, uuid, text, date, boolean, jsonb, uuid, uuid, uuid)
  from public, anon;
revoke all on function public.move_transactions_scope(uuid[], uuid, uuid) from public, anon;
revoke all on function public.category_usage(uuid) from public, anon;

grant execute on function public.upsert_transaction(uuid, date, int, uuid, text, jsonb, uuid, uuid, uuid)
  to authenticated;
grant execute on function
  public.upsert_recurring_rule(uuid, int, int, date, uuid, text, date, boolean, jsonb, uuid, uuid, uuid)
  to authenticated;
grant execute on function public.move_transactions_scope(uuid[], uuid, uuid) to authenticated;
grant execute on function public.category_usage(uuid) to authenticated;

-- トリガ関数は呼び出し元の権限で走るため EXECUTE が要る（§2.5）
grant execute on function public.splits_check_member() to authenticated;
grant execute on function public.recurring_rule_splits_check_member() to authenticated;
grant execute on function public.transactions_check_payer() to authenticated;
grant execute on function public.categories_before_insert() to authenticated;
grant execute on function public.categories_guard_update() to authenticated;
grant execute on function public.profiles_check_default_category() to authenticated;
