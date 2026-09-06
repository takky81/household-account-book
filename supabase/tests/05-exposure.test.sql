-- REST から叩ける関数の範囲（docs/仕様書.md §2.5 / §2.7）
--
-- PostgREST は公開スキーマ（public）の関数を /rest/v1/rpc/<名前> としてさらす。
-- さらしてよいのは画面が呼ぶ書き込み用の RPC だけで、ポリシーやトリガから呼ぶ
-- 判定関数は private に置く。関数を足すときにここが落ちたら、置き場所を間違えている。
begin;
select plan(4);

-- authenticated が実行できる public の SECURITY DEFINER 関数＝REST から叩けるもの
create temp view exposed as
select p.proname::text as name
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prosecdef
   and has_function_privilege('authenticated', p.oid, 'execute');

select set_eq(
  'select name from exposed',
  array[
    'create_share_group',
    'add_group_member',
    'remove_group_member',
    'delete_share_group',
    'upsert_transaction',
    'import_transactions',
    'delete_category',
    'move_category_scope',
    'move_transactions',
    'upsert_recurring_rule',
    'run_recurring_rules'
  ],
  'REST から叩ける SECURITY DEFINER 関数は書き込み用の RPC 11本だけ'
);

select ok(
  not has_schema_privilege('anon', 'private', 'usage'),
  '未ログインは private スキーマを使えない'
);

-- ポリシーの式は呼び出し元の権限で走るので、判定関数の EXECUTE は要る
select ok(
  has_function_privilege('authenticated', 'private.is_group_member_of(uuid, uuid)', 'execute'),
  'ログイン済みは判定関数を実行できる（ポリシーの中から呼ばれる）'
);

-- 上の検査が本当に効いているか。public へ戻すと増えることを見る（この変更は rollback される）
alter function private.is_group_member_of(uuid, uuid) set schema public;
select is(
  (select count(*)::int from exposed), 12,
  '判定関数を public へ戻すと、さらされる関数として数えられる'
);

select * from finish();
rollback;
