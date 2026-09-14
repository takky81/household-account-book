-- カテゴリの親の付け替え（docs/仕様書.md §2.7 / §3.4.1）
--
-- parent_id の直接 UPDATE は引き続き許さず、階層・予算・表示順を一度に整える RPC に閉じる。

create or replace function public.categories_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.categories%rowtype;
begin
  if new.kind is distinct from old.kind then
    raise exception '収支区分は変更できません。別のカテゴリを作って取引を付け替えてください';
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
    if new.parent_id is distinct from old.parent_id then
      raise exception '未分類カテゴリの親は変更できません';
    end if;
  end if;

  if new.parent_id is distinct from old.parent_id and new.parent_id is not null then
    select * into v_parent from public.categories c where c.id = new.parent_id;
    if not found then
      raise exception '親カテゴリが見つかりません';
    end if;
    if v_parent.id = old.id then
      raise exception 'カテゴリ自身を親にはできません';
    end if;
    if v_parent.parent_id is not null then
      raise exception '小分類の下へは移せません（階層は2段までです）';
    end if;
    if v_parent.is_system then
      raise exception '未分類の下へは移せません';
    end if;
    if v_parent.kind <> old.kind then
      raise exception '収支区分が異なるカテゴリの下へは移せません';
    end if;
    if exists (select 1 from public.categories c where c.parent_id = old.id) then
      raise exception '小分類を持つカテゴリは小分類にできません。先に配下を移してください';
    end if;
    if exists (select 1 from public.budgets b where b.category_id = old.id) then
      raise exception '予算があるカテゴリは小分類にできません。先に予算を削除してください';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.reparent_category(
  p_category_id uuid,
  p_parent_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.categories%rowtype;
  v_sort_order int;
begin
  perform public.require_uid();

  -- 子の追加・予算の追加との競合を避け、検査から更新まで階層の不変条件を保つ。
  lock table public.categories in share row exclusive mode;
  lock table public.budgets in share row exclusive mode;

  select * into v_category from public.categories c where c.id = p_category_id;
  if not found then
    raise exception 'カテゴリが見つかりません';
  end if;
  if v_category.is_system then
    raise exception '未分類カテゴリの親は変更できません';
  end if;
  if v_category.parent_id is not distinct from p_parent_id then
    return;
  end if;

  if p_parent_id is null then
    select coalesce(max(c.sort_order), 0) + 10 into v_sort_order
      from public.categories c
     where c.parent_id is null and c.kind = v_category.kind and not c.is_system
       and c.id <> p_category_id;
  else
    select coalesce(max(c.sort_order), 0) + 10 into v_sort_order
      from public.categories c where c.parent_id = p_parent_id and c.id <> p_category_id;
  end if;

  update public.categories c
     set parent_id = p_parent_id, sort_order = v_sort_order
   where c.id = p_category_id;
end;
$$;

revoke all on function public.reparent_category(uuid, uuid) from public, anon;
grant execute on function public.reparent_category(uuid, uuid) to authenticated;

