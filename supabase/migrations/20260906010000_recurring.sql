-- 定期登録（docs/仕様書.md §3.8 / §3.9 / §5.8）
--
-- 家賃のように毎月同じ日に同じ額で出ていく支出の雛形を持ち、期日が来たものを取引にする。
-- サーバーを持たない（§2.2）ため、生成の起点はアプリを開いた誰かになる。

set check_function_bodies = off;

-- --------------------------------------------------------- recurring_rules

create table public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  -- カテゴリ削除時にルールを付け替えるのは delete_category() の仕事。黙って消させない
  category_id uuid not null references public.categories (id) on delete restrict,
  payer_id uuid references auth.users (id) on delete restrict,
  -- 生成する取引の created_by に引き継ぐ（§2.7）。消えては困るので restrict
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  amount int not null,
  day_of_month int not null,
  memo text not null default '',
  start_month date not null,
  end_month date,
  is_paused boolean not null default false,
  splits_are_manual boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_rules_amount_ck check (amount > 0),
  constraint recurring_rules_day_ck check (day_of_month between 1 and 31),
  -- 月初でない日付を入れると、生成の記録の一意制約（month）をすり抜ける
  constraint recurring_rules_start_ck check (start_month = date_trunc('month', start_month)::date),
  constraint recurring_rules_end_ck check (
    end_month is null or end_month = date_trunc('month', end_month)::date
  ),
  constraint recurring_rules_range_ck check (end_month is null or start_month <= end_month)
);

comment on table public.recurring_rules is
  '定期登録ルール。毎月・固定額のみ。周期や金額の変動は扱わない（§3.8）';
comment on column public.recurring_rules.day_of_month is
  '支払日。その月に無い日は月末日へ丸める（§5.8）';

create index recurring_rules_category_idx on public.recurring_rules (category_id);

create table public.recurring_rule_splits (
  rule_id uuid not null references public.recurring_rules (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete restrict,
  amount int not null,
  primary key (rule_id, user_id),
  constraint recurring_rule_splits_amount_ck check (amount >= 0)
);

comment on table public.recurring_rule_splits is
  '負担の雛形。splits_are_manual のルールだけが行を持ち、合計は金額に一致する（§3.9）';

create table public.recurring_postings (
  rule_id uuid not null references public.recurring_rules (id) on delete cascade,
  month date not null,
  -- 生成した取引を消しても記録は残す。取引側の列で一意にすると、意図して消した取引が
  -- 次にアプリを開いた瞬間に戻ってくる（§3.9）
  transaction_id uuid references public.transactions (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (rule_id, month),
  constraint recurring_postings_month_ck check (month = date_trunc('month', month)::date)
);

comment on table public.recurring_postings is
  '生成の記録。(rule_id, month) の主キーが同じ対象月に2度作らないことを保証する（§3.9）';

create trigger recurring_rules_touch before update on public.recurring_rules
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------- トリガ
--
-- 支払者は取引とまったく同じ規則で検査する。transactions_check_payer() は
-- new.category_id と new.payer_id しか見ないので、規則が1か所に残るよう共用する。

create trigger recurring_rules_check_payer_insert
  before insert on public.recurring_rules
  for each row execute function public.transactions_check_payer();

create trigger recurring_rules_check_payer_update
  before update of payer_id, category_id on public.recurring_rules
  for each row
  when (old.payer_id is distinct from new.payer_id
        or old.category_id is distinct from new.category_id)
  execute function public.transactions_check_payer();

-- 負担の雛形の相手も、書き込み時点で共有範囲のメンバーであること（§3.6 と同じ）
create or replace function public.recurring_rule_splits_check_member()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_group uuid;
  v_owner uuid;
begin
  select c.share_group_id, c.owner_id into v_group, v_owner
    from public.recurring_rules r
    join public.categories c on c.id = r.category_id
   where r.id = new.rule_id;

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

create trigger recurring_rule_splits_check_member
  before insert or update on public.recurring_rule_splits
  for each row execute function public.recurring_rule_splits_check_member();

-- ------------------------------------------------- RLS とテーブル権限（§2.6）

alter table public.recurring_rules enable row level security;
alter table public.recurring_rule_splits enable row level security;
alter table public.recurring_postings enable row level security;

revoke all on public.recurring_rules, public.recurring_rule_splits, public.recurring_postings
  from anon, authenticated;

-- 作成と更新は RPC のみ（雛形の合計 = 金額 を関数の末尾で1回だけ検査するため）。
-- 削除はポリシーで許す。雛形と生成の記録は FK のカスケードで消え、作った取引は残る。
grant select, delete on public.recurring_rules to authenticated;

create policy recurring_rules_select on public.recurring_rules
  for select to authenticated
  using (category_id in (select private.accessible_category_ids()));

create policy recurring_rules_delete on public.recurring_rules
  for delete to authenticated
  using (category_id in (select private.accessible_category_ids()));

grant select on public.recurring_rule_splits to authenticated;

create policy recurring_rule_splits_select on public.recurring_rule_splits
  for select to authenticated
  using (
    exists (
      select 1 from public.recurring_rules r
      where r.id = rule_id
        and r.category_id in (select private.accessible_category_ids())
    )
  );

-- 生成済みかどうかの唯一の記録。書き込みも削除も与えない（手で消せると二重に作られる）
grant select on public.recurring_postings to authenticated;

create policy recurring_postings_select on public.recurring_postings
  for select to authenticated
  using (
    exists (
      select 1 from public.recurring_rules r
      where r.id = rule_id
        and r.category_id in (select private.accessible_category_ids())
    )
  );

-- ------------------------------------------------------------- 予定日（§5.8）

create or replace function private.recurring_due_date(p_month date, p_day int)
returns date
language sql
immutable
set search_path = ''
as $$
  -- その月に無い日（2月31日など）は月末日へ丸める
  select least(
    p_month + (p_day - 1),
    (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date
  );
$$;

-- --------------------------------------------------------------- 書き込み

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
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_old_category uuid;
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

  perform public.assert_category_accessible(p_category_id);

  if p_id is not null then
    select r.category_id into v_old_category from public.recurring_rules r where r.id = p_id;
    if v_old_category is null then
      raise exception '定期登録ルールが見つかりません';
    end if;
    -- 移動元も参照できないと、他人のルールを自分の側へ引き寄せられる
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
    insert into public.recurring_rules
      (category_id, payer_id, amount, day_of_month, memo,
       start_month, end_month, is_paused, splits_are_manual)
    values
      (p_category_id, p_payer_id, p_amount, p_day_of_month, coalesce(p_memo, ''),
       v_start, v_end, coalesce(p_is_paused, false), v_manual)
    returning id into v_id;
  else
    update public.recurring_rules r
       set category_id = p_category_id,
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

-- 期日の来た定期登録を取引にする（§5.8）
--
-- p_today は今日より後には進められない。未来の予定を先に作ると、まだ払っていない支出が
-- 集計と予算の消化に現れる。過去を指せるのはテストのため。
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

  -- 手順1・2。参照できるカテゴリの、止まっていないルールだけ。
  -- アーカイブ済みカテゴリのルールは動かさない（画面が警告として出す）
  for v_rule in
    select r.*
      from public.recurring_rules r
      join public.categories c on c.id = r.category_id
     where not r.is_paused
       and not c.is_archived
       and r.category_id in (select private.accessible_category_ids())
     order by r.created_at, r.id
  loop
    v_month := v_rule.start_month;

    while v_month <= v_last loop
      -- 手順3
      exit when v_rule.end_month is not null and v_month > v_rule.end_month;
      -- 手順4。予定日は月が進むほど後になるので、未来に届いたらこのルールは終わり
      v_due := private.recurring_due_date(v_month, v_rule.day_of_month);
      exit when v_due > v_today;

      begin
        -- 手順5。先に枠を取る。同時に2人が開いても、2件目はここで何もしない
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
            v_rule.category_id, v_due, v_rule.amount, v_rule.payer_id, v_rule.memo, v_splits
          );
          -- §2.7 の例外。実行した人ではなくルールを作った人の入力として残す
          update public.transactions t set created_by = v_rule.created_by where t.id = v_tx;
          update public.recurring_postings p set transaction_id = v_tx
           where p.rule_id = v_rule.id and p.month = v_month;

          v_created := v_created + 1;
        end if;
      exception when others then
        -- 失敗はルール単位で捕まえる。1件の失敗で他の固定費まで止まる方が困る。
        -- 枠の確保もここで巻き戻るので、原因を直せば次の起動でやり直せる
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

-- --------------------------------------------------- 既存の RPC への影響

-- カテゴリを消すとき、取引と同じく定期登録ルールも移動先へ付け替える（§3.10）
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

  -- 共有範囲は変わらないので負担も雛形もそのまま
  update public.transactions t set category_id = v_fallback where t.category_id = p_category_id;
  update public.recurring_rules r set category_id = v_fallback where r.category_id = p_category_id;
  delete from public.budgets b where b.category_id = p_category_id;
  delete from public.categories c where c.id = p_category_id;
end;
$$;

-- グループを消すとき、未分類に付いていた定期登録ルールも一緒に消す。
-- category_id が restrict なので、残っているとカスケードが必ず失敗する（§3.10）
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

  delete from public.recurring_rules r
   using public.categories c
   where c.id = r.category_id and c.share_group_id = p_share_group_id;

  -- メンバー・未分類カテゴリ・未分類に付いていた予算はカスケードで消える
  delete from public.share_groups g where g.id = p_share_group_id;
end;
$$;

-- 共有範囲を変えるとき、配下のルールも一緒に動かす。範囲が変わったら雛形は捨てて
-- 既定按分に戻す（§5.2 と同じ理由。まとめて操作したときだけ手入力が黙って残るのを防ぐ）
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
  v_rule_ids uuid[];
  v_scope_changed boolean;
  v_tx uuid;
begin
  -- 手順0
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

  -- 手順1。配下の小分類の取引とルールも対象に含める
  select coalesce(array_agg(t.id), '{}'::uuid[]) into v_ids from public.transactions t
   where t.category_id = p_category_id
      or t.category_id in (select c.id from public.categories c where c.parent_id = p_category_id);

  -- 統合すると移動先のルールも同じカテゴリに集まる。作り直す相手を先に控えておく
  select coalesce(array_agg(r.id), '{}'::uuid[]) into v_rule_ids from public.recurring_rules r
   where r.category_id = p_category_id
      or r.category_id in (select c.id from public.categories c where c.parent_id = p_category_id);

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
      update public.recurring_rules r
         set category_id = coalesce(v_child_target, v_target)
       where r.category_id = v_child.id;
      delete from public.budgets b where b.category_id = v_child.id;
      delete from public.categories c where c.id = v_child.id;
    end loop;
    update public.transactions t set category_id = v_target where t.category_id = p_category_id;
    update public.recurring_rules r set category_id = v_target where r.category_id = p_category_id;
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

    -- 既定按分のルールは雛形を持たない。捨てて false に戻すだけでよい（§3.9）
    delete from public.recurring_rule_splits s where s.rule_id = any (v_rule_ids);
    update public.recurring_rules r set splits_are_manual = false where r.id = any (v_rule_ids);
  end if;

  return v_target;
end;
$$;

-- ------------------------------------------------------- 実行権限（§2.5）

revoke all on function
  public.upsert_recurring_rule(uuid, int, int, date, uuid, text, date, boolean, jsonb, uuid)
  from public, anon;
revoke all on function public.run_recurring_rules(date) from public, anon;
revoke all on function private.recurring_due_date(date, int) from public, anon, authenticated;
revoke all on function public.recurring_rule_splits_check_member() from public, anon;
revoke all on function public.delete_category(uuid) from public, anon;
revoke all on function public.delete_share_group(uuid) from public, anon;
revoke all on function public.move_category_scope(uuid, uuid, uuid, boolean) from public, anon;

grant execute on function
  public.upsert_recurring_rule(uuid, int, int, date, uuid, text, date, boolean, jsonb, uuid)
  to authenticated;
grant execute on function public.run_recurring_rules(date) to authenticated;
grant execute on function public.delete_category(uuid) to authenticated;
grant execute on function public.delete_share_group(uuid) to authenticated;
grant execute on function public.move_category_scope(uuid, uuid, uuid, boolean) to authenticated;

-- 雛形のトリガはテーブルへの書き込みのたびに走る。呼び出し元の権限で実行されるため
-- EXECUTE が要る（is_group_member() などと同じ理由。§2.5）
grant execute on function public.recurring_rule_splits_check_member() to authenticated;
