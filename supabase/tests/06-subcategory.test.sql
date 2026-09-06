-- 小分類（docs/仕様書.md §3.4.1 / §3.7 / §5.2）
-- 決定表: カテゴリの管理 列16・列17・列18・列19・列21・列24
-- 決定表: 共有範囲の変更 列13・列14・列15
-- 決定表: 予算 列12
begin;
select plan(18);

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

-- 個人の大分類「食費」
insert into public.categories (share_group_id, kind, name) values (null, 'expense', '食費');
create temp table food as
select id from public.categories
 where owner_id = '11111111-1111-1111-1111-111111111111' and name = '食費';

-- 小分類。共有範囲と収支区分に嘘を入れても、親の値で上書きされる（§3.4.1）
insert into public.categories (parent_id, share_group_id, kind, name)
select id, (select gid from fx), 'income', '外食' from food;
create temp table eat as
select id from public.categories where name = '外食' and parent_id = (select id from food);

select is(
  (select c.share_group_id from public.categories c, eat where c.id = eat.id),
  null, '小分類の共有範囲は親からコピーされる'
);
select is(
  (select c.owner_id from public.categories c, eat where c.id = eat.id),
  '11111111-1111-1111-1111-111111111111'::uuid, '小分類の所有者は親からコピーされる'
);
select is(
  (select c.kind from public.categories c, eat where c.id = eat.id),
  'expense', '小分類の収支区分は親からコピーされる'
);

-- 列18 階層は2段まで
select throws_ok(
  $$ insert into public.categories (parent_id, kind, name)
     select id, 'expense', '寿司' from eat $$,
  'P0001', null, '列18 小分類の下には作れない'
);

-- 列19 未分類は親になれない
select throws_ok(
  $$ insert into public.categories (parent_id, kind, name)
     select id, 'expense', 'その他' from public.categories
      where owner_id = '11111111-1111-1111-1111-111111111111'
        and is_system and kind = 'expense' $$,
  'P0001', null, '列19 未分類の下には作れない'
);

-- 列16 同じ親に同じ名前は作れない
select throws_ok(
  $$ insert into public.categories (parent_id, kind, name)
     select id, 'expense', '外食' from food $$,
  '23505', null, '列16 同じ親に同名の小分類は作れない'
);

-- 列17 親が違えば同じ名前を作れる
insert into public.categories (share_group_id, kind, name) values (null, 'expense', '交際費');
create temp table party as
select id from public.categories
 where owner_id = '11111111-1111-1111-1111-111111111111' and name = '交際費';
select lives_ok(
  $$ insert into public.categories (parent_id, kind, name)
     select id, 'expense', '外食' from party $$,
  '列17 親が違えば同名の小分類を作れる'
);

-- 列12（予算）予算は大分類にしか置けない
select throws_ok(
  $$ insert into public.budgets (category_id, month, amount)
     select id, '2026-08-01', 5000 from eat $$,
  'P0001', null, '予算 列12 小分類に予算は置けない'
);

-- 列21 小分類が残っている大分類は削除できない
select throws_ok(
  $$ select public.delete_category((select id from food)) $$,
  'P0001', null, '列21 小分類が残る大分類は削除できない'
);

-- 列20 小分類を消すと、その取引は親へ移る
create temp table t1 as
select public.upsert_transaction(
  (select id from eat), '2026-08-31'::date, 1000,
  '11111111-1111-1111-1111-111111111111', '昼食'
) as id;
select lives_ok(
  $$ select public.delete_category((select id from eat)) $$,
  '小分類は削除できる'
);
select is(
  (select t.category_id from public.transactions t, t1 where t.id = t1.id),
  (select id from food), '列20 小分類の取引は親へ移る'
);

-- 列13 小分類だけでは共有範囲を変えられない
insert into public.categories (parent_id, kind, name) select id, 'expense', '自炊' from food;
create temp table cook as
select id from public.categories where name = '自炊' and parent_id = (select id from food);
select throws_ok(
  $$ select public.move_category_scope((select id from cook), (select gid from fx)) $$,
  'P0001', null, '列13 小分類の共有範囲は単独で変えられない'
);

-- 列14・列24 大分類を移すと配下の小分類と取引も移り、負担が作り直される
create temp table t2 as
select public.upsert_transaction(
  (select id from cook), '2026-08-31'::date, 1000,
  '11111111-1111-1111-1111-111111111111', '自炊'
) as id;
select lives_ok(
  $$ select public.move_category_scope((select id from food), (select gid from fx)) $$,
  '列14 大分類はグループへ移せる'
);
select is(
  (select c.share_group_id from public.categories c, cook where c.id = cook.id),
  (select gid from fx), '列14・列24 配下の小分類も一緒に移る'
);
select is(
  (select count(*)::int from public.transaction_splits s, t2 where s.transaction_id = t2.id),
  2, '列14 小分類の取引の負担も作り直される'
);

-- 列15 統合すると、移動元の小分類の取引は移動先の同名小分類へ移る
insert into public.categories (share_group_id, kind, name)
values ((select gid from fx), 'expense', 'pg-交際費');
create temp table dest as
select id from public.categories
 where share_group_id = (select gid from fx) and name = 'pg-交際費';
insert into public.categories (parent_id, kind, name) select id, 'expense', '飲み会' from dest;
create temp table dest_child as
select id from public.categories where name = '飲み会' and parent_id = (select id from dest);

insert into public.categories (share_group_id, kind, name) values (null, 'expense', 'pg-交際費');
create temp table src as
select id from public.categories
 where owner_id = '11111111-1111-1111-1111-111111111111' and name = 'pg-交際費';
insert into public.categories (parent_id, kind, name) select id, 'expense', '飲み会' from src;
create temp table src_child as
select id from public.categories where name = '飲み会' and parent_id = (select id from src);
create temp table t3 as
select public.upsert_transaction(
  (select id from src_child), '2026-08-31'::date, 1000,
  '11111111-1111-1111-1111-111111111111', '飲み会'
) as id;

select lives_ok(
  $$ select public.move_category_scope(
       (select id from src), (select gid from fx), null, true) $$,
  '列15 統合して移せる'
);
select is(
  (select t.category_id from public.transactions t, t3 where t.id = t3.id),
  (select id from dest_child), '列15 移動元の小分類の取引は移動先の同名小分類へ移る'
);
select is(
  (select count(*)::int from public.categories c
    where c.id in ((select id from src), (select id from src_child))),
  0, '列15 移動元の大分類と小分類は消える'
);

select * from finish();
rollback;
