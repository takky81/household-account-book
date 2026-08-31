-- RLS ポリシーとテーブル権限（docs/仕様書.md §2.6）
--
-- 列の制限は GRANT で行う。テーブルレベルの UPDATE は全列を含み、そこから
-- revoke update (col) で差し引くことはできないため、許可列だけを列挙して grant する。
-- INSERT と UPDATE は別々の権限なので、許可列も別々に与える。

alter table public.profiles enable row level security;
alter table public.share_groups enable row level security;
alter table public.share_group_members enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_splits enable row level security;
alter table public.budgets enable row level security;

revoke all on public.profiles, public.share_groups, public.share_group_members,
  public.categories, public.transactions, public.transaction_splits, public.budgets
  from anon, authenticated;

-- ---------------------------------------------------------------- profiles
-- 表示名の解決に使うため参照は絞らない。更新は本人の3列だけ。

grant select on public.profiles to authenticated;
grant update (display_name, color, default_category_id) on public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated using (true);

create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ------------------------------------------------------------ share_groups
-- 作成・削除は RPC のみ（作成直後は自分がまだメンバーではないため）。

grant select on public.share_groups to authenticated;
grant update (name) on public.share_groups to authenticated;

create policy share_groups_select on public.share_groups
  for select to authenticated using (public.is_group_member(id));

create policy share_groups_update on public.share_groups
  for update to authenticated
  using (public.is_group_member(id)) with check (public.is_group_member(id));

grant select on public.share_group_members to authenticated;
grant update (default_weight, sort_order) on public.share_group_members to authenticated;

create policy share_group_members_select on public.share_group_members
  for select to authenticated using (public.is_group_member(share_group_id));

create policy share_group_members_update on public.share_group_members
  for update to authenticated
  using (public.is_group_member(share_group_id))
  with check (public.is_group_member(share_group_id));

-- ------------------------------------------------------------- categories
-- share_group_id / kind は INSERT でのみ許可する。共有範囲と収支区分は
-- 作成時にしか決められず、変更は RPC 経由になる。
-- owner_id / is_system / created_by は既定値とトリガが入れるので与えない。

grant select on public.categories to authenticated;
grant insert (share_group_id, kind, name, color, sort_order) on public.categories to authenticated;
grant update (name, color, sort_order, is_archived) on public.categories to authenticated;

create policy categories_select on public.categories
  for select to authenticated
  using (
    case when share_group_id is null
         then owner_id = auth.uid()
         else public.is_group_member(share_group_id)
    end
  );

create policy categories_insert on public.categories
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and case when share_group_id is null
             then owner_id = auth.uid()
             else public.is_group_member(share_group_id)
        end
  );

create policy categories_update on public.categories
  for update to authenticated
  using (
    case when share_group_id is null
         then owner_id = auth.uid()
         else public.is_group_member(share_group_id)
    end
  )
  with check (
    case when share_group_id is null
         then owner_id = auth.uid()
         else public.is_group_member(share_group_id)
    end
  );

-- ----------------------------------------------------------- transactions
-- INSERT と amount / category_id の UPDATE は与えない。負担行の無い取引や、
-- 負担の合計が金額と合わない取引を作れてしまうため（§3.6）。

grant select on public.transactions to authenticated;
grant update (occurred_on, payer_id, memo) on public.transactions to authenticated;
grant delete on public.transactions to authenticated;

create policy transactions_select on public.transactions
  for select to authenticated
  using (category_id in (select public.accessible_category_ids()));

create policy transactions_update on public.transactions
  for update to authenticated
  using (category_id in (select public.accessible_category_ids()))
  with check (category_id in (select public.accessible_category_ids()));

create policy transactions_delete on public.transactions
  for delete to authenticated
  using (category_id in (select public.accessible_category_ids()));

-- 負担は SELECT だけ。DELETE も与えない（1行だけ消して合計を狂わせられるため）。
-- 親の取引を消したときの子行削除は FK のカスケードで行われ、子の DELETE 権限を要求しない。
grant select on public.transaction_splits to authenticated;

create policy transaction_splits_select on public.transaction_splits
  for select to authenticated
  using (
    exists (
      select 1 from public.transactions t
      where t.id = transaction_id
        and t.category_id in (select public.accessible_category_ids())
    )
  );

-- ---------------------------------------------------------------- budgets

grant select on public.budgets to authenticated;
grant insert (category_id, month, amount) on public.budgets to authenticated;
grant update (amount) on public.budgets to authenticated;
grant delete on public.budgets to authenticated;

create policy budgets_select on public.budgets
  for select to authenticated
  using (category_id in (select public.accessible_category_ids()));

create policy budgets_insert on public.budgets
  for insert to authenticated
  with check (category_id in (select public.accessible_category_ids()));

create policy budgets_update on public.budgets
  for update to authenticated
  using (category_id in (select public.accessible_category_ids()))
  with check (category_id in (select public.accessible_category_ids()));

create policy budgets_delete on public.budgets
  for delete to authenticated
  using (category_id in (select public.accessible_category_ids()));
