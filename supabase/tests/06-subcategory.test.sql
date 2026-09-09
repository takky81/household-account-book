-- 小分類（docs/仕様書.md §3.4.1 / §3.7）
--
-- カテゴリが全ユーザー共通になったので、小分類が親から引き継ぐのは収支区分だけ。
-- 共有範囲は取引の側にあり、カテゴリの階層とは無関係。
-- 決定表: カテゴリの管理 列16・列17・列18・列19・列21・列24
-- 決定表: 予算 列12
begin;
select plan(14);

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

-- 大分類「pg-食費」
insert into public.categories (kind, name) values ('expense', 'pg-食費');
create temp table food as select id from public.categories where name = 'pg-食費';

-- 小分類。収支区分に嘘を入れても、親の値で上書きされる（§3.4.1）
insert into public.categories (parent_id, kind, name)
select id, 'income', 'pg-外食' from food;
create temp table eat as
select id from public.categories where name = 'pg-外食' and parent_id = (select id from food);

select is(
  (select c.kind from public.categories c, eat where c.id = eat.id),
  'expense', '小分類の収支区分は親からコピーされる'
);
select is(
  (select c.parent_id from public.categories c, eat where c.id = eat.id),
  (select id from food), '小分類は親を指す'
);

-- 列18 階層は2段まで
select throws_ok(
  $$ insert into public.categories (parent_id, kind, name)
     select id, 'expense', 'pg-寿司' from eat $$,
  'P0001', null, '列18 小分類の下には作れない'
);

-- 列19 未分類は親になれない
select throws_ok(
  $$ insert into public.categories (parent_id, kind, name)
     select id, 'expense', 'pg-その他' from public.categories
      where is_system and kind = 'expense' $$,
  'P0001', null, '列19 未分類の下には作れない'
);

-- 列16 同じ親に同じ名前は作れない
select throws_ok(
  $$ insert into public.categories (parent_id, kind, name)
     select id, 'expense', 'pg-外食' from food $$,
  '23505', null, '列16 同じ親に同名の小分類は作れない'
);

-- 列17 親が違えば同じ名前を作れる
insert into public.categories (kind, name) values ('expense', 'pg-交際費');
create temp table party as select id from public.categories where name = 'pg-交際費';
select lives_ok(
  $$ insert into public.categories (parent_id, kind, name)
     select id, 'expense', 'pg-外食' from party $$,
  '列17 親が違えば同名の小分類を作れる'
);

-- 大分類の名前は全体で一意（共有範囲ごとの重複がなくなった）
select throws_ok(
  $$ insert into public.categories (kind, name) values ('expense', 'pg-食費') $$,
  '23505', null, '同じ収支区分に同名の大分類は作れない'
);

-- 列12（予算）予算は大分類にしか置けない
select throws_ok(
  $$ insert into public.budgets (category_id, owner_id, month, amount)
     select id, '11111111-1111-1111-1111-111111111111', '2026-08-01', 5000 from eat $$,
  'P0001', null, '予算 列12 小分類に予算は置けない'
);

-- 列21 小分類が残っている大分類は削除できない
select throws_ok(
  $$ select public.delete_category((select id from food)) $$,
  'P0001', null, '列21 小分類が残る大分類は削除できない'
);

-- 列20 小分類を消すと、その取引は親へ移る。共有範囲は取引側にあるので動かない
create temp table t1 as
select public.upsert_transaction(
  p_category_id => (select id from eat),
  p_occurred_on => '2026-08-31'::date,
  p_amount => 1000,
  p_payer_id => '11111111-1111-1111-1111-111111111111',
  p_memo => '昼食',
  p_share_group_id => (select gid from fx)
) as id;
select lives_ok(
  $$ select public.delete_category((select id from eat)) $$,
  '小分類は削除できる'
);
select is(
  (select t.category_id from public.transactions t, t1 where t.id = t1.id),
  (select id from food), '列20 小分類の取引は親へ移る'
);
select is(
  (select t.share_group_id from public.transactions t, t1 where t.id = t1.id),
  (select gid from fx), '小分類を消しても取引の共有範囲は変わらない'
);
select is(
  (select count(*)::int from public.transaction_splits s, t1 where s.transaction_id = t1.id),
  2, '共有範囲が変わらないので負担も作り直されない'
);

-- 大分類を消すと取引は未分類へ移る（共有範囲ごとではなく、全体で1つの未分類）
create temp table t2 as
select public.upsert_transaction(
  p_category_id => (select id from party),
  p_occurred_on => '2026-08-31'::date,
  p_amount => 300,
  p_payer_id => '11111111-1111-1111-1111-111111111111',
  p_owner_id => '11111111-1111-1111-1111-111111111111'
) as id;
-- 小分類は RPC で消す（categories への DELETE は誰にも与えていない）
select public.delete_category(
  (select c.id from public.categories c where c.parent_id = (select id from party)));
select public.delete_category((select id from party));
select is(
  (select t.category_id from public.transactions t, t2 where t.id = t2.id),
  (select c.id from public.categories c where c.is_system and c.kind = 'expense'),
  '列24 大分類の取引は全体共通の未分類へ移る'
);

select * from finish();
rollback;
