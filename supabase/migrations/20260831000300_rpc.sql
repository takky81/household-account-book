-- 書き込み用の RPC（docs/仕様書.md §2.7 / §5.2）
--
-- 複数行にまたがる不変条件を持つ操作は関数に閉じる。SECURITY DEFINER なので
-- RLS が効かない。権限の検査は各関数の冒頭で自分で行う。

-- ------------------------------------------------------------- 共通の道具

create or replace function public.require_uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception '認証が必要です';
  end if;
  return v_uid;
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
    select 1 from public.accessible_category_ids() a where a = p_category_id
  ) then
    raise exception 'そのカテゴリは参照できません';
  end if;
end;
$$;

-- 負担を既定按分で作り直す（§5.1）
create or replace function public.rebuild_splits(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat uuid;
  v_amount int;
  v_payer uuid;
begin
  select t.category_id, t.amount, t.payer_id into v_cat, v_amount, v_payer
    from public.transactions t where t.id = p_transaction_id;

  delete from public.transaction_splits s where s.transaction_id = p_transaction_id;
  insert into public.transaction_splits (transaction_id, user_id, amount)
  select p_transaction_id, d.user_id, d.amount
    from public.default_splits(v_cat, v_amount, v_payer) d
   where d.amount >= 0;

  update public.transactions t set splits_are_manual = false where t.id = p_transaction_id;
end;
$$;

-- 負担の合計が金額に一致することを確かめる（行トリガでは書けない検査）
create or replace function public.assert_splits_balanced(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount int;
  v_sum int;
begin
  select t.amount into v_amount from public.transactions t where t.id = p_transaction_id;
  select coalesce(sum(s.amount), -1) into v_sum
    from public.transaction_splits s where s.transaction_id = p_transaction_id;
  if v_sum <> v_amount then
    raise exception '負担の合計（%）が金額（%）と一致しません', v_sum, v_amount;
  end if;
end;
$$;

-- ----------------------------------------------------------- 共有グループ

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
  -- 呼び出し元自身が入っていないと、作った本人から見えないグループができる
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

  -- 未分類は共有範囲 × 収支区分ごとに1つ
  insert into public.categories (share_group_id, created_by, kind, name, is_system, sort_order)
  values (v_gid, v_uid, 'expense', '未分類', true, 9999),
         (v_gid, v_uid, 'income', '未分類', true, 9999);

  return v_gid;
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
  if not public.is_group_member(p_share_group_id) then
    raise exception 'そのグループのメンバーではありません';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception '存在しない利用者です';
  end if;
  if public.is_group_member_of(p_share_group_id, p_user_id) then
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
  if not public.is_group_member(p_share_group_id) then
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
  if not public.is_group_member(p_share_group_id) then
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

-- ----------------------------------------------------------------- 取引

create or replace function public.upsert_transaction(
  p_category_id uuid,
  p_occurred_on date,
  p_amount int,
  p_payer_id uuid default null,
  p_memo text default '',
  p_splits jsonb default null,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_uid();
  v_id uuid;
  v_old_category uuid;
  v_manual boolean := p_splits is not null;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception '金額は1以上の整数にしてください';
  end if;
  perform public.assert_category_accessible(p_category_id);

  if p_id is not null then
    select t.category_id into v_old_category from public.transactions t where t.id = p_id;
    if v_old_category is null then
      raise exception '取引が見つかりません';
    end if;
    -- 移動元も参照できないと、他人の取引を自分の側へ引き寄せられる
    perform public.assert_category_accessible(v_old_category);
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
      (category_id, payer_id, created_by, occurred_on, amount, memo, splits_are_manual)
    values
      (p_category_id, p_payer_id, v_uid, p_occurred_on, p_amount, coalesce(p_memo, ''), v_manual)
    returning id into v_id;
  else
    update public.transactions t
       set category_id = p_category_id,
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
      from public.default_splits(p_category_id, p_amount, p_payer_id) d;
  end if;

  perform public.assert_splits_balanced(v_id);
  return v_id;
end;
$$;

-- CSV の一括取り込み（§4.4）。各行は upsert_transaction と同じ検査を通る
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
      (v_row->>'category_id')::uuid,
      (v_row->>'occurred_on')::date,
      (v_row->>'amount')::int,
      nullif(v_row->>'payer_id', '')::uuid,
      coalesce(v_row->>'memo', ''),
      v_row->'splits'
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('inserted', v_count);
end;
$$;

-- ------------------------------------------------------------- カテゴリ

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
  v_fallback uuid;
begin
  perform public.require_uid();
  perform public.assert_category_accessible(p_category_id);

  select c.share_group_id, c.owner_id, c.kind, c.is_system
    into v_group, v_owner, v_kind, v_is_system
    from public.categories c where c.id = p_category_id;

  if v_is_system then
    raise exception '未分類カテゴリは削除できません';
  end if;

  select c.id into v_fallback from public.categories c
   where c.is_system and c.kind = v_kind
     and c.share_group_id is not distinct from v_group
     and c.owner_id is not distinct from v_owner;
  if v_fallback is null then
    raise exception 'その共有範囲の未分類カテゴリが見つかりません';
  end if;

  -- 共有範囲は変わらないので負担はそのまま
  update public.transactions t set category_id = v_fallback where t.category_id = p_category_id;
  delete from public.budgets b where b.category_id = p_category_id;
  delete from public.categories c where c.id = p_category_id;
end;
$$;

-- ------------------------------------------------------- 共有範囲の変更
--
-- §5.2 の手順を1つのトランザクションで行う。行ごとに更新すると権限のない行が
-- 黙って残り部分適用になるため、必ずここに集約する。

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
       and not public.is_group_member_of(p_dest_group, t.payer_id);
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
    if not public.is_group_member(p_dest_share_group_id) then
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
       and t.category_id not in (select public.accessible_category_ids())
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
