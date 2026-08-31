-- 権限モデルの穴が塞がっているか（docs/仕様書.md §2.6 / §2.7）
-- supabase-js から直接叩ける操作を SQL で再現して、通らないことを確かめる。
-- 決定表: アクセス制御 列2・列3・列4・列5・列6・列7・列8・列9・列10・列11・列12・列13・列14
-- 決定表: 取引の入力と編集 列4
-- 決定表: 予算 列5・列8
begin;
select plan(16);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pg-taro@example.com', 'x', now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pg-hana@example.com', 'x', now(), now()),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pg-other@example.com', 'x', now(), now());

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;

create temp table fx as
select public.create_share_group(
  '夫婦',
  '[{"user_id":"11111111-1111-1111-1111-111111111111","default_weight":1,"sort_order":10},
    {"user_id":"22222222-2222-2222-2222-222222222222","default_weight":1,"sort_order":20}]'::jsonb
) as gid;

insert into public.categories (share_group_id, kind, name)
select fx.gid, 'expense', '家賃' from fx;

create temp table ids as
select
  (select c.id from public.categories c, fx where c.share_group_id = fx.gid and c.name = '家賃') as cat,
  (select c.id from public.categories c
    where c.owner_id = '11111111-1111-1111-1111-111111111111'
      and c.kind = 'expense' and c.is_system) as own_cat,
  (select c.id from public.categories c
    where c.owner_id = '11111111-1111-1111-1111-111111111111'
      and c.kind = 'income' and c.is_system) as own_income;

create temp table tx as
select public.upsert_transaction(
  (select cat from ids), '2026-08-31'::date, 1000,
  '11111111-1111-1111-1111-111111111111', '8月分'
) as id;

-- 取引の直接 INSERT。負担行の無い取引を作れてしまうため与えていない
select throws_ok(
  $$ insert into public.transactions (category_id, occurred_on, amount)
     select cat, '2026-08-01', 100 from ids $$,
  '42501', null, '取引を直接 INSERT できない'
);

-- 金額の直接 UPDATE。負担の合計を狂わせられる
select throws_ok(
  $$ update public.transactions set amount = 1 $$,
  '42501', null, '金額を直接 UPDATE できない'
);

-- カテゴリの付け替えを直接できると §5.2 の検査を迂回できる
select throws_ok(
  $$ update public.transactions set category_id = (select own_cat from ids) $$,
  '42501', null, 'カテゴリを直接 UPDATE できない'
);

-- 負担行を1行だけ消すと「合計 ≠ 金額」を作れる
select throws_ok(
  $$ delete from public.transaction_splits $$,
  '42501', null, '負担行を直接 DELETE できない'
);
select throws_ok(
  $$ update public.transaction_splits set amount = 0 $$,
  '42501', null, '負担行を直接 UPDATE できない'
);

-- 共有範囲と収支区分は作成時にしか決められない
select throws_ok(
  $$ update public.categories set share_group_id = null $$,
  '42501', null, 'カテゴリの共有範囲を直接 UPDATE できない'
);
select throws_ok(
  $$ update public.categories set kind = 'income' $$,
  '42501', null, 'カテゴリの収支区分を直接 UPDATE できない'
);

-- 個人カテゴリの取引を「共用」にはできない（支払額基準の集計が崩れる）
select throws_ok(
  $$ select public.upsert_transaction((select own_cat from ids), '2026-08-31', 100, null) $$,
  'P0001', null, '個人カテゴリの支払者を共用にできない'
);

-- 自分の個人取引に他人の負担を積めない。積めると相手からは見えないまま集計が狂う
select throws_ok(
  $$ select public.upsert_transaction(
       (select own_cat from ids), '2026-08-31', 100,
       '11111111-1111-1111-1111-111111111111', '',
       '[{"user_id":"22222222-2222-2222-2222-222222222222","amount":100}]'::jsonb) $$,
  'P0001', null, '個人カテゴリの負担は本人だけ'
);

-- 予算は月初だけ。月中の日付を入れると同じ対象月の行が複数できる
select throws_ok(
  $$ insert into public.budgets (category_id, month, amount)
     select cat, '2026-08-15', 1000 from ids $$,
  '23514', null, '月初でない予算は入れられない'
);
select throws_ok(
  $$ insert into public.budgets (category_id, month, amount)
     select own_income, '2026-08-01', 1000 from ids $$,
  'P0001', null, '収入カテゴリに予算は置けない'
);

-- 属さないグループのデータには id を知っていても触れない
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select throws_ok(
  $$ select public.upsert_transaction(
       (select c.id from public.categories c
         where c.owner_id = '33333333-3333-3333-3333-333333333333'
           and c.kind = 'expense' and c.is_system),
       '2026-08-31', 100, '33333333-3333-3333-3333-333333333333', '',
       null, (select id from tx)) $$,
  'P0001', null, '他人の取引を自分の側へ引き寄せられない'
);
select throws_ok(
  $$ select public.move_category_scope(
       (select c.id from public.categories c
         where c.owner_id = '33333333-3333-3333-3333-333333333333'
           and c.kind = 'expense' and c.is_system),
       (select gid from fx)) $$,
  'P0001', null, '属さないグループへカテゴリを押し込めない'
);

-- 他人の表示名は変えられない（参照は全員に開けるが更新は本人だけ）
update public.profiles set display_name = 'のっとり'
 where id = '11111111-1111-1111-1111-111111111111';
select is(
  (select p.display_name from public.profiles p
    where p.id = '11111111-1111-1111-1111-111111111111'),
  'pg-taro', '他人の表示名は更新されない'
);

-- profiles は全員が読めるので、参照できないカテゴリ id を既定に置けてはいけない
select throws_ok(
  $$ update public.profiles set default_category_id = (select cat from ids)
      where id = '33333333-3333-3333-3333-333333333333' $$,
  'P0001', null, '参照できないカテゴリを既定にできない'
);

-- 未ログインからは RPC を叩けない
set local role anon;
select throws_ok(
  $$ select public.upsert_transaction(
       '00000000-0000-0000-0000-000000000000', '2026-08-31', 100) $$,
  '42501', null, 'anon は RPC を実行できない'
);

select * from finish();
rollback;
