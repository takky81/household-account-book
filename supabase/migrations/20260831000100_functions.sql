-- 判定関数とトリガ（docs/仕様書.md §2.5 / §3）
--
-- 判定関数を SECURITY DEFINER にするのは、share_group_members のポリシーが
-- is_group_member() を呼び、その関数が同じ表を読むとポリシーが無限再帰するため。
-- どれも set search_path = '' とし、本文はスキーマ修飾する。

-- ------------------------------------------------------------- 判定関数

create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.share_group_members m
    where m.share_group_id = gid and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_group_member_of(gid uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.share_group_members m
    where m.share_group_id = gid and m.user_id = uid
  );
$$;

-- 全テーブルの RLS はこの関数の条件を唯一の防壁にしている。緩めると全部が緩む。
create or replace function public.accessible_category_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.categories c
  where c.owner_id = auth.uid()
     or public.is_group_member(c.share_group_id);
$$;

-- 指定した利用者から見えるカテゴリか（profiles の既定カテゴリの検査に使う）
create or replace function public.can_user_access_category(uid uuid, cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.categories c
    where c.id = cid
      and (c.owner_id = uid or public.is_group_member_of(c.share_group_id, uid))
  );
$$;

-- --------------------------------------------------------- 既定の負担按分
--
-- §5.1。RPC の中からだけ呼ぶ（authenticated に execute を与えない）。

create or replace function public.default_splits(
  p_category_id uuid,
  p_amount int,
  p_payer_id uuid
)
returns table (user_id uuid, amount int)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_group uuid;
  v_owner uuid;
  v_kind text;
  v_weight_sum bigint;
begin
  select c.share_group_id, c.owner_id, c.kind into v_group, v_owner, v_kind
    from public.categories c where c.id = p_category_id;
  if not found then
    raise exception 'カテゴリが見つかりません: %', p_category_id;
  end if;

  -- 個人カテゴリは本人が全額
  if v_group is null then
    return query select v_owner, p_amount;
    return;
  end if;

  -- 収入は受け取った本人 100%。支出用の重みを取り分に流用しない
  if v_kind = 'income' and p_payer_id is not null then
    return query select p_payer_id, p_amount;
    return;
  end if;

  select coalesce(sum(m.default_weight), 0) into v_weight_sum
    from public.share_group_members m
   where m.share_group_id = v_group and m.default_weight > 0;

  -- 重み > 0 のメンバーが1人もいないとき。支払者がいれば全額、共用なら全員を重み1
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
    where sgm.share_group_id = v_group
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
  -- 端数は重みの大きい順に1円ずつ配る。合計は必ず p_amount に一致する
  select
    base.user_id,
    (base.base_amount
      + case when base.rn <= p_amount - sum(base.base_amount) over () then 1 else 0 end)::int
  from base;
end;
$$;

-- ------------------------------------------------- カテゴリのトリガ

create or replace function public.categories_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 共有カテゴリに owner_id の既定値（auth.uid()）が残ると check に当たる
  if new.share_group_id is not null then
    new.owner_id := null;
  end if;
  return new;
end;
$$;

create trigger categories_before_insert
  before insert on public.categories
  for each row execute function public.categories_before_insert();

create or replace function public.categories_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
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
    if new.share_group_id is distinct from old.share_group_id
       or new.owner_id is distinct from old.owner_id then
      raise exception '未分類カテゴリの共有範囲は変更できません';
    end if;
  end if;
  return new;
end;
$$;

create trigger categories_guard_update
  before update on public.categories
  for each row execute function public.categories_guard_update();

-- --------------------------------------------------- 取引・負担のトリガ

create or replace function public.transactions_check_payer()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_group uuid;
  v_owner uuid;
begin
  select c.share_group_id, c.owner_id into v_group, v_owner
    from public.categories c where c.id = new.category_id;

  if v_group is null then
    -- 個人カテゴリ。null（共用）を通すと、update だけで個人の取引を共用にできてしまう
    if new.payer_id is distinct from v_owner then
      raise exception '個人カテゴリの支払者は本人だけです';
    end if;
  elsif new.payer_id is not null
        and not public.is_group_member_of(v_group, new.payer_id) then
    raise exception '支払者がその共有グループのメンバーではありません';
  end if;
  return new;
end;
$$;

create trigger transactions_check_payer_insert
  before insert on public.transactions
  for each row execute function public.transactions_check_payer();

-- 値が実際に変わったときだけ検査する。脱退した人が支払者の過去の取引を、
-- 備考の修正だけで保存できなくしないため（update of だけでは SET 句に現れたら発火する）
create trigger transactions_check_payer_update
  before update of payer_id, category_id on public.transactions
  for each row
  when (old.payer_id is distinct from new.payer_id
        or old.category_id is distinct from new.category_id)
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
  select c.share_group_id, c.owner_id into v_group, v_owner
    from public.transactions t
    join public.categories c on c.id = t.category_id
   where t.id = new.transaction_id;

  if v_group is null then
    -- 個人カテゴリの共有範囲のメンバーは所有者1人だけ
    if new.user_id is distinct from v_owner then
      raise exception '個人カテゴリの負担は本人だけです';
    end if;
  elsif not public.is_group_member_of(v_group, new.user_id) then
    raise exception '負担の相手がその共有グループのメンバーではありません';
  end if;
  return new;
end;
$$;

create trigger splits_check_member
  before insert or update on public.transaction_splits
  for each row execute function public.splits_check_member();

-- ------------------------------------------------------- 予算のトリガ

create or replace function public.budgets_check_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select c.kind from public.categories c where c.id = new.category_id) <> 'expense' then
    raise exception '予算は支出カテゴリにだけ置けます';
  end if;
  return new;
end;
$$;

create trigger budgets_check_kind
  before insert or update of category_id on public.budgets
  for each row execute function public.budgets_check_kind();

-- --------------------------------------------- profiles の既定カテゴリ

create or replace function public.profiles_check_default_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.default_category_id is not null then
    if not public.can_user_access_category(new.id, new.default_category_id) then
      raise exception '参照できないカテゴリは既定にできません';
    end if;
    if (select c.is_archived from public.categories c where c.id = new.default_category_id) then
      raise exception 'アーカイブ済みのカテゴリは既定にできません';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_check_default_category
  before insert or update of default_category_id on public.profiles
  for each row execute function public.profiles_check_default_category();

-- ------------------------------------------------ 利用者の作成時の初期化
--
-- 管理画面や Admin API からの作成は JWT を持たず auth.uid() が NULL になるため、
-- owner_id / created_by には new.id を明示的に入れる（既定値に頼れない）。

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

  -- 一意制約に当たると auth.users への INSERT ごと失敗するため、連番を付けて必ず成功させる
  v_name := v_base;
  while exists (select 1 from public.profiles p where p.display_name = v_name) loop
    v_n := v_n + 1;
    v_name := v_base || '-' || v_n;
  end loop;

  insert into public.profiles (id, display_name) values (new.id, v_name);

  insert into public.categories (share_group_id, owner_id, created_by, kind, name, is_system, sort_order)
  values
    (null, new.id, new.id, 'expense', '未分類', true, 9999),
    (null, new.id, new.id, 'income', '未分類', true, 9999);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
