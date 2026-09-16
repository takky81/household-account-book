-- 取引をカテゴリとは別の目的で横断できるタグ。
-- タグ名はカテゴリと同じく全利用者共通だが、紐付けの公開範囲は親の取引・ルールに従う。

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  name text not null,
  color text not null default '#64748b',
  sort_order int not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tags_name_ck check (name = btrim(name) and name <> '' and position(';' in name) = 0)
);

create unique index tags_name_uq on public.tags (name);

create trigger tags_touch before update on public.tags
  for each row execute function public.touch_updated_at();

create table public.transaction_tags (
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete restrict,
  primary key (transaction_id, tag_id)
);

create index transaction_tags_tag_id_idx on public.transaction_tags (tag_id, transaction_id);

create table public.recurring_rule_tags (
  rule_id uuid not null references public.recurring_rules (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete restrict,
  primary key (rule_id, tag_id)
);

create index recurring_rule_tags_tag_id_idx on public.recurring_rule_tags (tag_id, rule_id);

alter table public.tags enable row level security;
alter table public.transaction_tags enable row level security;
alter table public.recurring_rule_tags enable row level security;
alter table public.tags force row level security;
alter table public.transaction_tags force row level security;
alter table public.recurring_rule_tags force row level security;

create policy tags_select on public.tags for select to authenticated using (true);
create policy tags_insert on public.tags for insert to authenticated with check (true);
create policy tags_update on public.tags for update to authenticated using (true) with check (true);

create policy transaction_tags_select on public.transaction_tags for select to authenticated
using (
  exists (
    select 1 from public.transactions t
     where t.id = transaction_tags.transaction_id
       and (t.owner_id = auth.uid()
            or t.share_group_id in (select private.accessible_group_ids()))
  )
);

create policy recurring_rule_tags_select on public.recurring_rule_tags for select to authenticated
using (
  exists (
    select 1 from public.recurring_rules r
     where r.id = recurring_rule_tags.rule_id
       and (r.owner_id = auth.uid()
            or r.share_group_id in (select private.accessible_group_ids()))
  )
);

grant select on public.tags, public.transaction_tags, public.recurring_rule_tags to authenticated;
grant insert (name, color, sort_order) on public.tags to authenticated;
grant update (name, color, sort_order, is_archived) on public.tags to authenticated;

-- UUID 配列として渡されたタグを検査する。紐付けの書き込みは各 RPC だけが行う。
create or replace function public.assert_tags(p_tag_ids jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_tag_ids is null or jsonb_typeof(p_tag_ids) <> 'array' then
    raise exception 'タグの指定が不正です';
  end if;
  if (select count(distinct value) from jsonb_array_elements_text(p_tag_ids))
     <> jsonb_array_length(p_tag_ids) then
    raise exception '同じタグが2回指定されています';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_tag_ids) e(value)
     where not exists (select 1 from public.tags t where t.id = e.value::uuid)
  ) then
    raise exception 'タグが見つかりません';
  end if;
end;
$$;

drop function public.upsert_transaction(uuid, date, int, uuid, text, jsonb, uuid, uuid, uuid);

create function public.upsert_transaction(
  p_category_id uuid,
  p_occurred_on date,
  p_amount int,
  p_payer_id uuid default null,
  p_memo text default '',
  p_splits jsonb default null,
  p_id uuid default null,
  p_share_group_id uuid default null,
  p_owner_id uuid default null,
  p_tag_ids jsonb default '[]'::jsonb
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
  perform public.assert_tags(p_tag_ids);

  select c.kind into v_kind from public.categories c where c.id = p_category_id;

  if p_id is not null then
    select true, t.share_group_id, t.owner_id into v_found, v_old_group, v_old_owner
      from public.transactions t where t.id = p_id;
    if not coalesce(v_found, false) then raise exception '取引が見つかりません'; end if;
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
       <> jsonb_array_length(p_splits) then raise exception '同じ人が負担に2回現れています'; end if;
    if (select coalesce(sum((e->>'amount')::int), -1) from jsonb_array_elements(p_splits) e)
       <> p_amount then raise exception '負担の合計が金額と一致しません'; end if;
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
       set category_id = p_category_id, share_group_id = p_share_group_id,
           owner_id = p_owner_id, payer_id = p_payer_id, occurred_on = p_occurred_on,
           amount = p_amount, memo = coalesce(p_memo, ''), splits_are_manual = v_manual
     where t.id = p_id returning t.id into v_id;
  end if;

  delete from public.transaction_splits s where s.transaction_id = v_id;
  if v_manual then
    insert into public.transaction_splits (transaction_id, user_id, amount)
    select v_id, (e->>'user_id')::uuid, (e->>'amount')::int from jsonb_array_elements(p_splits) e;
  else
    insert into public.transaction_splits (transaction_id, user_id, amount)
    select v_id, d.user_id, d.amount
      from public.default_splits(p_share_group_id, p_owner_id, v_kind, p_amount, p_payer_id) d;
  end if;

  delete from public.transaction_tags tt where tt.transaction_id = v_id;
  insert into public.transaction_tags (transaction_id, tag_id)
  select v_id, e.value::uuid from jsonb_array_elements_text(p_tag_ids) e(value);

  perform public.assert_splits_balanced(v_id);
  return v_id;
end;
$$;

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
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception '取り込む行がありません'; end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    perform public.upsert_transaction(
      p_category_id => (v_row->>'category_id')::uuid,
      p_occurred_on => (v_row->>'occurred_on')::date,
      p_amount => (v_row->>'amount')::int,
      p_payer_id => nullif(v_row->>'payer_id', '')::uuid,
      p_memo => coalesce(v_row->>'memo', ''), p_splits => v_row->'splits',
      p_share_group_id => nullif(v_row->>'share_group_id', '')::uuid,
      p_owner_id => nullif(v_row->>'owner_id', '')::uuid,
      p_tag_ids => coalesce(v_row->'tag_ids', '[]'::jsonb)
    );
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('inserted', v_count);
end;
$$;

drop function public.upsert_recurring_rule(uuid, int, int, date, uuid, text, date, boolean, jsonb, uuid, uuid, uuid);

create function public.upsert_recurring_rule(
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
  p_owner_id uuid default null,
  p_tag_ids jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid; v_old_group uuid; v_old_owner uuid; v_found boolean;
  v_manual boolean := p_splits is not null;
  v_start date := date_trunc('month', p_start_month)::date;
  v_end date := case when p_end_month is null then null else date_trunc('month', p_end_month)::date end;
begin
  perform public.require_uid();
  if p_amount is null or p_amount <= 0 then raise exception '金額は1以上の整数にしてください'; end if;
  if p_day_of_month is null or p_day_of_month < 1 or p_day_of_month > 31 then
    raise exception '支払日は1〜31の日にしてください';
  end if;
  if v_start is null then raise exception '開始月を指定してください'; end if;
  if v_end is not null and v_end < v_start then raise exception '終了月は開始月以降にしてください'; end if;
  perform public.assert_category_exists(p_category_id);
  perform public.assert_scope_accessible(p_share_group_id, p_owner_id);
  perform public.assert_tags(p_tag_ids);

  if p_id is not null then
    select true, r.share_group_id, r.owner_id into v_found, v_old_group, v_old_owner
      from public.recurring_rules r where r.id = p_id;
    if not coalesce(v_found, false) then raise exception '定期登録ルールが見つかりません'; end if;
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
       <> jsonb_array_length(p_splits) then raise exception '同じ人が負担に2回現れています'; end if;
    if (select coalesce(sum((e->>'amount')::int), -1) from jsonb_array_elements(p_splits) e)
       <> p_amount then raise exception '負担の合計が金額と一致しません'; end if;
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
       set category_id = p_category_id, share_group_id = p_share_group_id, owner_id = p_owner_id,
           payer_id = p_payer_id, amount = p_amount, day_of_month = p_day_of_month,
           memo = coalesce(p_memo, ''), start_month = v_start, end_month = v_end,
           is_paused = coalesce(p_is_paused, false), splits_are_manual = v_manual
     where r.id = p_id returning r.id into v_id;
  end if;

  delete from public.recurring_rule_splits s where s.rule_id = v_id;
  if v_manual then
    insert into public.recurring_rule_splits (rule_id, user_id, amount)
    select v_id, (e->>'user_id')::uuid, (e->>'amount')::int from jsonb_array_elements(p_splits) e;
  end if;
  delete from public.recurring_rule_tags rt where rt.rule_id = v_id;
  insert into public.recurring_rule_tags (rule_id, tag_id)
  select v_id, e.value::uuid from jsonb_array_elements_text(p_tag_ids) e(value);
  return v_id;
end;
$$;

create or replace function public.run_recurring_rules(p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date; v_rule record; v_month date; v_last date; v_due date;
  v_splits jsonb; v_tag_ids jsonb; v_tx uuid; v_claimed uuid;
  v_created int := 0; v_failed int := 0; v_failures jsonb := '[]'::jsonb;
begin
  perform public.require_uid();
  v_today := least(coalesce(p_today, current_date), current_date);
  v_last := date_trunc('month', v_today)::date;
  for v_rule in
    select r.* from public.recurring_rules r join public.categories c on c.id = r.category_id
     where not r.is_paused and not c.is_archived
       and (r.owner_id = auth.uid() or r.share_group_id in (select private.accessible_group_ids()))
     order by r.created_at, r.id
  loop
    v_month := v_rule.start_month;
    while v_month <= v_last loop
      exit when v_rule.end_month is not null and v_month > v_rule.end_month;
      v_due := private.recurring_due_date(v_month, v_rule.day_of_month);
      exit when v_due > v_today;
      begin
        v_claimed := null;
        insert into public.recurring_postings (rule_id, month) values (v_rule.id, v_month)
        on conflict do nothing returning rule_id into v_claimed;
        if v_claimed is not null then
          if v_rule.splits_are_manual then
            select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'amount', s.amount))
              into v_splits from public.recurring_rule_splits s where s.rule_id = v_rule.id;
          else v_splits := null; end if;
          select coalesce(jsonb_agg(rt.tag_id order by rt.tag_id), '[]'::jsonb)
            into v_tag_ids from public.recurring_rule_tags rt where rt.rule_id = v_rule.id;
          v_tx := public.upsert_transaction(
            p_category_id => v_rule.category_id, p_occurred_on => v_due,
            p_amount => v_rule.amount, p_payer_id => v_rule.payer_id, p_memo => v_rule.memo,
            p_splits => v_splits, p_share_group_id => v_rule.share_group_id,
            p_owner_id => v_rule.owner_id, p_tag_ids => v_tag_ids
          );
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

revoke all on function public.assert_tags(jsonb) from public, anon, authenticated;
revoke all on function public.upsert_transaction(uuid, date, int, uuid, text, jsonb, uuid, uuid, uuid, jsonb)
  from public, anon;
revoke all on function
  public.upsert_recurring_rule(uuid, int, int, date, uuid, text, date, boolean, jsonb, uuid, uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.upsert_transaction(uuid, date, int, uuid, text, jsonb, uuid, uuid, uuid, jsonb)
  to authenticated;
grant execute on function
  public.upsert_recurring_rule(uuid, int, int, date, uuid, text, date, boolean, jsonb, uuid, uuid, uuid, jsonb)
  to authenticated;

