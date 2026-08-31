-- 共有範囲の変更（docs/仕様書.md §2.8 / §5.2）
-- 決定表: 共有範囲の変更 列1・列2・列3・列8・列10
begin;
select plan(11);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pg-taro@example.com', 'x', now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pg-hana@example.com', 'x', now(), now());

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;

create temp table fx as
select public.create_share_group(
  'pg-夫婦',
  '[{"user_id":"11111111-1111-1111-1111-111111111111","default_weight":1,"sort_order":10},
    {"user_id":"22222222-2222-2222-2222-222222222222","default_weight":1,"sort_order":20}]'::jsonb
) as gid;

-- 個人の食費に取引を1件
insert into public.categories (share_group_id, kind, name) values (null, 'expense', '食費');
create temp table c1 as
select id from public.categories
 where owner_id = '11111111-1111-1111-1111-111111111111' and name = '食費';

create temp table t1 as
select public.upsert_transaction(
  (select id from c1), '2026-08-31'::date, 1000,
  '11111111-1111-1111-1111-111111111111', 'スーパー'
) as id;

select is(
  (select s.amount from public.transaction_splits s, t1 where s.transaction_id = t1.id),
  1000, '個人カテゴリでは本人が全額を負担する'
);

-- 個人 → グループ。負担が既定割合で作り直される
select lives_ok(
  $$ select public.move_category_scope((select id from c1), (select gid from fx)) $$,
  '個人カテゴリをグループへ移せる'
);
select is(
  (select count(*)::int from public.transaction_splits s, t1 where s.transaction_id = t1.id),
  2, '共有範囲が変わると負担が作り直される'
);
select is(
  (select s.amount from public.transaction_splits s, t1
    where s.transaction_id = t1.id and s.user_id = '22222222-2222-2222-2222-222222222222'),
  500, '折半になる'
);

-- 同じ名前のカテゴリが移動先にあると中止する
insert into public.categories (share_group_id, kind, name) values (null, 'expense', '食費');
create temp table c2 as
select id from public.categories
 where owner_id = '11111111-1111-1111-1111-111111111111' and name = '食費';

select throws_ok(
  $$ select public.move_category_scope((select id from c2), (select gid from fx)) $$,
  'P0001', null, '移動先に同名があると中止する'
);

-- 統合を選ぶと、取引が移動先へ移り、移動元のカテゴリと予算が消える
insert into public.budgets (category_id, month, amount) select id, '2026-08-01', 5000 from c2;
select lives_ok(
  $$ select public.move_category_scope((select id from c2), (select gid from fx), null, true) $$,
  '統合を選べば移せる'
);
select is(
  (select count(*)::int from public.categories c, c2 where c.id = c2.id),
  0, '統合すると移動元のカテゴリは消える'
);
select is(
  (select count(*)::int from public.budgets b, c2 where b.category_id = c2.id),
  0, '移動元の予算行は破棄される'
);

-- 未分類の共有範囲は変えられない
select throws_ok(
  $$ select public.move_category_scope(
       (select c.id from public.categories c
         where c.owner_id = '11111111-1111-1111-1111-111111111111'
           and c.kind = 'expense' and c.is_system),
       (select gid from fx)) $$,
  'P0001', null, '未分類の共有範囲は変えられない'
);

-- 同じ共有範囲の中での付け替えでは、手入力の負担を保つ
insert into public.categories (share_group_id, kind, name) select gid, 'expense', '家賃' from fx;
create temp table t2 as
select public.upsert_transaction(
  (select c.id from public.categories c, fx where c.share_group_id = fx.gid and c.name = '家賃'),
  '2026-08-31'::date, 1000, '11111111-1111-1111-1111-111111111111', '',
  '[{"user_id":"11111111-1111-1111-1111-111111111111","amount":700},
    {"user_id":"22222222-2222-2222-2222-222222222222","amount":300}]'::jsonb
) as id;

select public.move_transactions(
  array[(select id from t2)],
  (select c.id from public.categories c, fx where c.share_group_id = fx.gid and c.name = '食費')
);

select is(
  (select s.amount from public.transaction_splits s, t2
    where s.transaction_id = t2.id and s.user_id = '11111111-1111-1111-1111-111111111111'),
  700, '同じ共有範囲の中では手入力の負担が保たれる'
);
select is(
  (select t.splits_are_manual from public.transactions t, t2 where t.id = t2.id),
  true, 'splits_are_manual も保たれる'
);

select * from finish();
rollback;
