-- 関数の実行権限（docs/仕様書.md §2.5）
--
-- 関数は既定で PUBLIC に EXECUTE が付く。SECURITY DEFINER の関数がそのままだと
-- 未ログイン（anon）からも叩けるため、いったん全部剥がしてから authenticated にだけ配る。

do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn.sig);
  end loop;
end;
$$;

-- RLS ポリシーとトリガの中から呼ばれる判定関数。
-- ポリシーの式もトリガ関数の本体も呼び出し元の権限で走るため、これが無いと
-- 通常の SELECT / UPDATE が permission denied になる。
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.is_group_member_of(uuid, uuid) to authenticated;
grant execute on function public.accessible_category_ids() to authenticated;
grant execute on function public.can_user_access_category(uuid, uuid) to authenticated;

-- 書き込み用の RPC（§2.7）
grant execute on function public.create_share_group(text, jsonb) to authenticated;
grant execute on function public.add_group_member(uuid, uuid, int, int) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.delete_share_group(uuid) to authenticated;
grant execute on function public.upsert_transaction(uuid, date, int, uuid, text, jsonb, uuid) to authenticated;
grant execute on function public.import_transactions(jsonb) to authenticated;
grant execute on function public.delete_category(uuid) to authenticated;
grant execute on function public.move_category_scope(uuid, uuid, uuid, boolean) to authenticated;
grant execute on function public.move_transactions(uuid[], uuid) to authenticated;

-- default_splits / rebuild_splits / assert_* / require_uid は RPC の中からだけ呼ぶ。
-- authenticated には配らない（DEFINER の RPC は postgres として走るので実行できる）。
