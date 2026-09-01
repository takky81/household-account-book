-- 判定関数を非公開スキーマへ移す（docs/仕様書.md §2.5）
--
-- PostgREST は公開スキーマ（public）の関数を /rest/v1/rpc/<名前> として全部さらす。
-- RLS ポリシーとトリガから呼ぶ判定関数は authenticated に EXECUTE を与えないと
-- 通常の SELECT が落ちるため権限は外せず、その結果 REST から直接叩けていた。
-- とくに is_group_member_of(gid, uid) と can_user_access_category(uid, cid) は
-- 他人の uuid を引数に取るので、「利用者 X はグループ Y のメンバーか」を問い合わせられた。
--
-- private スキーマは PostgREST が公開しないので、ポリシーからは今までどおり呼べて、
-- REST の入口からは消える。書き込み用の RPC（§2.7）は画面から呼ぶので public に残す。

create schema if not exists private;

-- スキーマを使えないと中の関数も呼べない。作成権限は誰にも与えない。
-- service_role にも要る。管理接続からの書き込みでもトリガは走り、その中から判定関数を呼ぶ
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ポリシーもトリガも関数を OID で指しているので、移しても張り直しは要らない。
-- 実行権限（EXECUTE）も関数に付いたまま移る。
alter function public.is_group_member(uuid) set schema private;
alter function public.is_group_member_of(uuid, uuid) set schema private;
alter function public.accessible_category_ids() set schema private;
alter function public.can_user_access_category(uuid, uuid) set schema private;

-- 本体は search_path = '' で走るため、呼び出しはスキーマ名込みで書いてある。
-- 移した4つを呼んでいる関数を、private を指すように入れ直す。
-- （create or replace は既存の権限を保つので、grant はやり直さなくてよい）

create or replace function private.is_group_member(gid uuid)
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

create or replace function private.is_group_member_of(gid uuid, uid uuid)
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

create or replace function private.accessible_category_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.categories c
  where c.owner_id = auth.uid()
     or private.is_group_member(c.share_group_id);
$$;

create or replace function private.can_user_access_category(uid uuid, cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.categories c
    where c.id = cid
      and (c.owner_id = uid or private.is_group_member_of(c.share_group_id, uid))
  );
$$;

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
        and not private.is_group_member_of(v_group, new.payer_id) then
    raise exception '支払者がその共有グループのメンバーではありません';
  end if;
  return new;
end;
$$;

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
  elsif not private.is_group_member_of(v_group, new.user_id) then
    raise exception '負担の相手がその共有グループのメンバーではありません';
  end if;
  return new;
end;
$$;

create or replace function public.profiles_check_default_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.default_category_id is not null then
    if not private.can_user_access_category(new.id, new.default_category_id) then
      raise exception '参照できないカテゴリは既定にできません';
    end if;
    if (select c.is_archived from public.categories c where c.id = new.default_category_id) then
      raise exception 'アーカイブ済みのカテゴリは既定にできません';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.assert_category_accessible(p_category_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from private.accessible_category_ids() a where a = p_category_id
  ) then
    raise exception 'そのカテゴリは参照できません';
  end if;
end;
$$;

create or replace function public.add_group_member(
  p_share_group_id uuid,
  p_user_id uuid,
  p_default_weight int default 1,
  p_sort_order int default 0
)
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
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception '存在しない利用者です';
  end if;
  if private.is_group_member_of(p_share_group_id, p_user_id) then
    raise exception 'すでにメンバーです';
  end if;
  if p_default_weight < 0 then
    raise exception '負担割合は0以上にしてください';
  end if;

  insert into public.share_group_members (share_group_id, user_id, default_weight, sort_order)
  values (p_share_group_id, p_user_id, p_default_weight, p_sort_order);
end;
$$;

create or replace function public.remove_group_member(p_share_group_id uuid, p_user_id uuid)
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
  -- メンバーが0人になると誰からも見えず、配下の取引ごと復旧できなくなる
  if (select count(*) from public.share_group_members m
        where m.share_group_id = p_share_group_id) <= 1 then
    raise exception '最後のメンバーは外せません';
  end if;

  delete from public.share_group_members m
   where m.share_group_id = p_share_group_id and m.user_id = p_user_id;
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
    select 1 from public.categories c
     where c.share_group_id = p_share_group_id and not c.is_system
  ) then
    raise exception 'カテゴリが残っているグループは削除できません';
  end if;
  if exists (
    select 1 from public.transactions t
      join public.categories c on c.id = t.category_id
     where c.share_group_id = p_share_group_id
  ) then
    raise exception '取引が残っているグループは削除できません';
  end if;

  -- メンバー・未分類カテゴリ・未分類に付いていた予算はカスケードで消える
  delete from public.share_groups g where g.id = p_share_group_id;
end;
$$;

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
    -- 手順3。移動先が個人なら、他人の支払い・他人の負担が混ざっていてはいけない
    select count(*) into v_bad from public.transactions t
     where t.id = any (p_transaction_ids)
       and (t.payer_id is distinct from p_dest_owner
            or exists (select 1 from public.transaction_splits s
                        where s.transaction_id = t.id and s.user_id <> p_dest_owner));
    if v_bad > 0 then
      raise exception '他の人が支払った、または負担している取引が % 件あります', v_bad;
    end if;
  else
    -- 手順4。支払者が「共用」の取引は共有から共有への移動では許す
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
  v_target uuid;
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

  select c.share_group_id, c.owner_id, c.kind, c.name, c.is_system
    into v_group, v_owner, v_kind, v_name, v_is_system
    from public.categories c where c.id = p_category_id;

  if v_is_system then
    raise exception '未分類カテゴリの共有範囲は変更できません';
  end if;

  v_scope_changed := v_group is distinct from p_dest_share_group_id
                     or v_owner is distinct from p_dest_owner_id;

  -- 手順1
  select array_agg(t.id) into v_ids from public.transactions t where t.category_id = p_category_id;
  v_ids := coalesce(v_ids, '{}'::uuid[]);

  -- 手順2。アーカイブ済みも一意性の判定に含まれるので、画面に出ていないものと衝突しうる
  select c.id into v_target from public.categories c
   where c.kind = v_kind and c.name = v_name
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
    update public.transactions t set category_id = v_target where t.category_id = p_category_id;
    delete from public.budgets b where b.category_id = p_category_id;
    delete from public.categories c where c.id = p_category_id;
  else
    update public.categories c
       set share_group_id = p_dest_share_group_id, owner_id = p_dest_owner_id
     where c.id = p_category_id;
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
  v_dest_group uuid;
  v_dest_owner uuid;
  v_tx uuid;
  v_count int := 0;
  v_scope_changed boolean;
begin
  perform public.require_uid();
  perform public.assert_category_accessible(p_dest_category_id);

  -- 移動元もすべて参照できること
  if exists (
    select 1 from public.transactions t
     where t.id = any (p_transaction_ids)
       and t.category_id not in (select private.accessible_category_ids())
  ) then
    raise exception '参照できない取引が含まれています';
  end if;

  select c.share_group_id, c.owner_id into v_dest_group, v_dest_owner
    from public.categories c where c.id = p_dest_category_id;

  -- 手順2（同名カテゴリの衝突）はこの経路には課さない。移動先は既存カテゴリそのもの
  perform public.assert_move_allowed(p_transaction_ids, v_dest_group, v_dest_owner);

  foreach v_tx in array p_transaction_ids loop
    select (c.share_group_id is distinct from v_dest_group)
        or (c.owner_id is distinct from v_dest_owner)
      into v_scope_changed
      from public.transactions t join public.categories c on c.id = t.category_id
     where t.id = v_tx;

    update public.transactions t set category_id = p_dest_category_id where t.id = v_tx;

    if v_scope_changed then
      perform public.rebuild_splits(v_tx);
      perform public.assert_splits_balanced(v_tx);
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- 念のため、移した4つの実行権限を明示しておく（§2.5）
revoke all on function
  private.is_group_member(uuid),
  private.is_group_member_of(uuid, uuid),
  private.accessible_category_ids(),
  private.can_user_access_category(uuid, uuid)
from public, anon;

grant execute on function
  private.is_group_member(uuid),
  private.is_group_member_of(uuid, uuid),
  private.accessible_category_ids(),
  private.can_user_access_category(uuid, uuid)
to authenticated, service_role;
