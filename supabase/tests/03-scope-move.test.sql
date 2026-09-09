-- 共有範囲の変更（docs/仕様書.md §2.8 / §5.2）
--
-- カテゴリは共有範囲を持たなくなったので、経路は2つ。
--  - move_transactions()       カテゴリを替える（共有範囲は動かない → 負担は保つ）
--  - move_transactions_scope() 共有範囲を替える（カテゴリは動かない → 負担を作り直す）
-- 決定表: 共有範囲の変更 列1・列2・列3・列8・列10
begin;
select plan(12);

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

insert into public.categories (kind, name) values ('expense', 'pg-食費');
create temp table c1 as select id from public.categories where name = 'pg-食費';

-- 個人の共有範囲に取引を1件
create temp table t1 as
select public.upsert_transaction(
  p_category_id => (select id from c1),
  p_occurred_on => '2026-08-31'::date,
  p_amount => 1000,
  p_payer_id => '11111111-1111-1111-1111-111111111111',
  p_memo => 'スーパー',
  p_owner_id => '11111111-1111-1111-1111-111111111111'
) as id;

select is(
  (select s.amount from public.transaction_splits s, t1 where s.transaction_id = t1.id),
  1000, '個人の共有範囲では本人が全額を負担する'
);

-- 列1 個人 → グループ。負担が既定割合で作り直される
select lives_ok(
  $$ select public.move_transactions_scope(
       array[(select id from t1)], (select gid from fx)) $$,
  '列1 個人の取引をグループへ移せる'
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
select is(
  (select t.category_id from public.transactions t, t1 where t.id = t1.id),
  (select id from c1), '共有範囲を変えてもカテゴリは動かない'
);

-- 列8 移動先が個人なら、他人が負担している取引は移せない
select throws_ok(
  $$ select public.move_transactions_scope(
       array[(select id from t1)], null, '11111111-1111-1111-1111-111111111111') $$,
  'P0001', null, '列8 他人が負担している取引は個人へ戻せない'
);

-- 列10 移動先グループのメンバーでない人が支払った取引は移せない
insert into public.categories (kind, name) values ('expense', 'pg-雑費');
create temp table t2 as
select public.upsert_transaction(
  p_category_id => (select id from public.categories where name = 'pg-雑費'),
  p_occurred_on => '2026-08-31'::date,
  p_amount => 500,
  p_payer_id => '11111111-1111-1111-1111-111111111111',
  p_owner_id => '11111111-1111-1111-1111-111111111111'
) as id;
select throws_ok(
  $$ select public.move_transactions_scope(
       array[(select id from t2)], null, '22222222-2222-2222-2222-222222222222') $$,
  'P0001', null, '列10 自分以外の個人範囲へは移せない'
);

-- 列2 共用払いの取引は、共有から共有への移動では許す
create temp table fx2 as
select public.create_share_group(
  'pg-家族',
  '[{"user_id":"11111111-1111-1111-1111-111111111111","default_weight":1,"sort_order":10},
    {"user_id":"22222222-2222-2222-2222-222222222222","default_weight":1,"sort_order":20}]'::jsonb
) as gid;
create temp table t3 as
select public.upsert_transaction(
  p_category_id => (select id from c1),
  p_occurred_on => '2026-08-31'::date,
  p_amount => 900,
  p_payer_id => null,
  p_memo => '共用払い',
  p_share_group_id => (select gid from fx)
) as id;
select lives_ok(
  $$ select public.move_transactions_scope(
       array[(select id from t3)], (select gid from fx2)) $$,
  '列2 共用払いの取引は共有から共有へ移せる'
);

-- 列3 同じ共有範囲の中でのカテゴリの付け替えでは、手入力の負担を保つ
insert into public.categories (kind, name) values ('expense', 'pg-家賃');
create temp table t4 as
select public.upsert_transaction(
  p_category_id => (select id from public.categories where name = 'pg-家賃'),
  p_occurred_on => '2026-08-31'::date,
  p_amount => 1000,
  p_payer_id => '11111111-1111-1111-1111-111111111111',
  p_splits => '[{"user_id":"11111111-1111-1111-1111-111111111111","amount":700},
                {"user_id":"22222222-2222-2222-2222-222222222222","amount":300}]'::jsonb,
  p_share_group_id => (select gid from fx)
) as id;

select is(
  public.move_transactions(array[(select id from t4)], (select id from c1)),
  1, '列3 カテゴリを付け替えられる'
);
select is(
  (select s.amount from public.transaction_splits s, t4
    where s.transaction_id = t4.id and s.user_id = '11111111-1111-1111-1111-111111111111'),
  700, '列3 カテゴリの付け替えでは手入力の負担が保たれる'
);
select is(
  (select t.splits_are_manual from public.transactions t, t4 where t.id = t4.id),
  true, 'splits_are_manual も保たれる'
);
select is(
  (select t.share_group_id from public.transactions t, t4 where t.id = t4.id),
  (select gid from fx), 'カテゴリを替えても共有範囲は動かない'
);

select * from finish();
rollback;
