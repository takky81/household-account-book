-- 小分類（docs/仕様書.md §3.4.1 / §3.7 / §5.2）
--
-- カテゴリに親を1段だけ持たせる。小分類の共有範囲・収支区分は親からコピーする。
-- 列を持たせず親をたどる形にはできない。RLS ポリシーと accessible_category_ids() が
-- share_group_id / owner_id を直接見ており、再帰にすると全テーブルの防壁が壊れる。

alter table public.categories
  add column parent_id uuid references public.categories (id) on delete restrict;

comment on column public.categories.parent_id is
  '親カテゴリ。null なら大分類、非 null なら小分類（階層は2段まで）';

create index categories_parent_idx on public.categories (parent_id);

-- 未分類は小分類になれない（親にもなれないことはトリガで守る）
alter table public.categories
  add constraint categories_system_parent_ck check (not (is_system and parent_id is not null));

-- 大分類の一意性に parent_id is null を足さないと『食費 / 外食』と『交際費 / 外食』を並べられない。
-- 小分類は同じ親の中でだけ一意（共有範囲と収支区分は親と一致するので親だけで足りる）
drop index public.categories_group_uq;
drop index public.categories_own_uq;

create unique index categories_group_uq
  on public.categories (share_group_id, kind, name)
  where share_group_id is not null and parent_id is null;

create unique index categories_own_uq
  on public.categories (owner_id, kind, name)
  where owner_id is not null and parent_id is null;

create unique index categories_child_uq
  on public.categories (parent_id, name)
  where parent_id is not null;

-- 親は作成時にしか決められない（§2.6）。付け替えの経路は持たない
grant insert (parent_id) on public.categories to authenticated;

-- ------------------------------------------------- カテゴリのトリガ

create or replace function public.categories_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.categories%rowtype;
begin
  if new.parent_id is not null then
    -- 参照できない親は「見つからない」になる（RLS が効く INVOKER のまま）
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
    -- 共有範囲と収支区分は親からコピーする。送られてきた値は捨てる
    new.share_group_id := v_parent.share_group_id;
    new.owner_id := v_parent.owner_id;
    new.kind := v_parent.kind;
    return new;
  end if;

  -- 共有カテゴリに owner_id の既定値（auth.uid()）が残ると check に当たる
  if new.share_group_id is not null then
    new.owner_id := null;
  end if;
  return new;
end;
$$;

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
    if new.share_group_id is distinct from old.share_group_id
       or new.owner_id is distinct from old.owner_id then
      raise exception '未分類カテゴリの共有範囲は変更できません';
    end if;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------- 予算のトリガ
--
-- 予算は大分類にだけ置く（§3.7）。親と小分類の両方に置けると同じ支出が2つの枠に
-- 数えられ、消化率がどちらを指すか決まらなくなる。

create or replace function public.budgets_check_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text;
  v_parent uuid;
begin
  select c.kind, c.parent_id into v_kind, v_parent
    from public.categories c where c.id = new.category_id;
  if v_kind <> 'expense' then
    raise exception '予算は支出カテゴリにだけ置けます';
  end if;
  if v_parent is not null then
    raise exception '予算は大分類にだけ置けます。小分類の実績は親に合算されます';
  end if;
  return new;
end;
$$;

-- --------------------------------------------------- カテゴリの削除
--
-- 移動先は、小分類なら親、大分類なら未分類（§3.4.1）。どちらも共有範囲が変わらないので
-- 負担は作り直さない。小分類が残っている大分類は削除できない。

create or replace function public.delete_category(p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
  v_owner uuid;
  v_kind text;
  v_is_system boolean;
  v_parent uuid;
  v_fallback uuid;
begin
  perform public.require_uid();
  perform public.assert_category_accessible(p_category_id);

  select c.share_group_id, c.owner_id, c.kind, c.is_system, c.parent_id
    into v_group, v_owner, v_kind, v_is_system, v_parent
    from public.categories c where c.id = p_category_id;

  if v_is_system then
    raise exception '未分類カテゴリは削除できません';
  end if;

  if v_parent is not null then
    v_fallback := v_parent;
  else
    if exists (select 1 from public.categories c where c.parent_id = p_category_id) then
      raise exception '小分類が残っています。先に小分類を削除してください';
    end if;
    select c.id into v_fallback from public.categories c
     where c.is_system and c.kind = v_kind
       and c.share_group_id is not distinct from v_group
       and c.owner_id is not distinct from v_owner;
    if v_fallback is null then
      raise exception 'その共有範囲の未分類カテゴリが見つかりません';
    end if;
  end if;

  -- 共有範囲は変わらないので負担はそのまま
  update public.transactions t set category_id = v_fallback where t.category_id = p_category_id;
  delete from public.budgets b where b.category_id = p_category_id;
  delete from public.categories c where c.id = p_category_id;
end;
$$;

-- ------------------------------------------------------- 共有範囲の変更
--
-- 移動の単位は大分類。配下の小分類とその取引もまとめて動かす（§5.2）。
-- 統合するときは parent_id を書き換えず、取引を付け替えて移動元の小分類を消す。

create or replace function public.move_category_scope(
  p_category_id uuid,
  p_dest_share_group_id uuid default null,
  p_dest_owner_id uuid default null,
  p_merge boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_uid();
  v_group uuid;
  v_owner uuid;
  v_kind text;
  v_name text;
  v_is_system boolean;
  v_parent uuid;
  v_target uuid;
  v_child record;
  v_child_target uuid;
  v_ids uuid[];
  v_scope_changed boolean;
  v_tx uuid;
begin
  -- 手順0。呼び出し元の権限。支払者の検査は取引0件のカテゴリを素通りさせるので代わりにならない
  perform public.assert_category_accessible(p_category_id);
  if num_nonnulls(p_dest_share_group_id, p_dest_owner_id) <> 1 then
    raise exception '移動先の共有範囲を1つだけ指定してください';
  end if;
  if p_dest_share_group_id is not null then
    if not private.is_group_member(p_dest_share_group_id) then
      raise exception '移動先グループのメンバーではありません';
    end if;
  elsif p_dest_owner_id <> v_uid then
    raise exception '移動先は自分の個人範囲だけです';
  end if;

  select c.share_group_id, c.owner_id, c.kind, c.name, c.is_system, c.parent_id
    into v_group, v_owner, v_kind, v_name, v_is_system, v_parent
    from public.categories c where c.id = p_category_id;

  if v_is_system then
    raise exception '未分類カテゴリの共有範囲は変更できません';
  end if;
  if v_parent is not null then
    raise exception '小分類だけでは共有範囲を変えられません。大分類ごと移してください';
  end if;

  v_scope_changed := v_group is distinct from p_dest_share_group_id
                     or v_owner is distinct from p_dest_owner_id;

  -- 手順1。配下の小分類の取引も対象に含める
  select coalesce(array_agg(t.id), '{}'::uuid[]) into v_ids from public.transactions t
   where t.category_id = p_category_id
      or t.category_id in (select c.id from public.categories c where c.parent_id = p_category_id);

  -- 手順2。アーカイブ済みも一意性の判定に含まれるので、画面に出ていないものと衝突しうる
  select c.id into v_target from public.categories c
   where c.kind = v_kind and c.name = v_name and c.parent_id is null
     and c.share_group_id is not distinct from p_dest_share_group_id
     and c.owner_id is not distinct from p_dest_owner_id;

  if v_target is not null and v_target <> p_category_id then
    if not p_merge then
      raise exception '移動先に同じ名前のカテゴリがあります。統合するか中止してください';
    end if;
  end if;

  -- 手順3・4
  perform public.assert_move_allowed(v_ids, p_dest_share_group_id, p_dest_owner_id);

  -- 手順5
  if v_target is not null and v_target <> p_category_id then
    -- 移動元の小分類は、移動先の同名の小分類へ。無ければ移動先の大分類そのものへ
    for v_child in
      select c.id, c.name from public.categories c where c.parent_id = p_category_id
    loop
      select c.id into v_child_target from public.categories c
       where c.parent_id = v_target and c.name = v_child.name;
      update public.transactions t
         set category_id = coalesce(v_child_target, v_target)
       where t.category_id = v_child.id;
      delete from public.budgets b where b.category_id = v_child.id;
      delete from public.categories c where c.id = v_child.id;
    end loop;
    update public.transactions t set category_id = v_target where t.category_id = p_category_id;
    delete from public.budgets b where b.category_id = p_category_id;
    delete from public.categories c where c.id = p_category_id;
  else
    update public.categories c
       set share_group_id = p_dest_share_group_id, owner_id = p_dest_owner_id
     where c.id = p_category_id or c.parent_id = p_category_id;
    v_target := p_category_id;
  end if;

  -- 手順6。共有範囲が変わったときだけ作り直す
  if v_scope_changed then
    foreach v_tx in array v_ids loop
      perform public.rebuild_splits(v_tx);
      perform public.assert_splits_balanced(v_tx);
    end loop;
  end if;

  return v_target;
end;
$$;

-- 関数を作り直したので実行権限を配り直す（§2.5。create or replace は権限を保つが、
-- 引数が同じでも意図を明示しておく）
revoke all on function public.delete_category(uuid) from public, anon;
revoke all on function public.move_category_scope(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.delete_category(uuid) to authenticated;
grant execute on function public.move_category_scope(uuid, uuid, uuid, boolean) to authenticated;
