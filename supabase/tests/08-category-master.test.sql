-- 全ユーザー共通のカテゴリ（docs/仕様書.md §2.4 / §3.4）
--
-- カテゴリは共有範囲を持たない共通のマスタになった。誰でも見え、誰でも作れ、誰でも直せる。
-- 縛るのは削除だけ。他人の取引が黙って未分類へ飛ぶのを止める。
-- 改名は止めない（誤字直しと意味の付け替えを機械では見分けられない）。代わりに
-- category_usage() が影響の件数を返し、画面が保存前に見せて確かめる。
-- 決定表: カテゴリの管理 列22・列23・列25・列26
begin;
select plan(13);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pg-taro@example.com', 'x', now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pg-hana@example.com', 'x', now(), now());

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;

insert into public.categories (kind, name) values ('expense', 'pg-食費');
create temp table food as select id from public.categories where name = 'pg-食費';

-- taro が個人範囲で1件使う
create temp table t1 as
select public.upsert_transaction(
  p_category_id => (select id from food),
  p_occurred_on => '2026-08-31'::date,
  p_amount => 1000,
  p_payer_id => '11111111-1111-1111-1111-111111111111',
  p_owner_id => '11111111-1111-1111-1111-111111111111'
) as id;

-- 列22 自分しか使っていなければ削除できる
select is(
  ((select public.category_usage((select id from food)))->>'others_transactions')::int,
  0, '列22 自分だけが使っているカテゴリは他人の取引0件'
);

-- hana からもカテゴリは見える（共通マスタ）
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from public.categories where name = 'pg-食費'), 1,
  'カテゴリは作った人以外にも見える'
);
select is(
  (select count(*)::int from public.transactions), 0,
  'カテゴリは見えても、他人の個人範囲の取引は見えない'
);

-- 列25 改名は誰でもできる（作成者でなくてもよい）
select lives_ok(
  $$ update public.categories set name = 'pg-食料費' where name = 'pg-食費' $$,
  '列25 他人が作ったカテゴリでも改名できる'
);
select is(
  (select c.name from public.categories c, food where c.id = food.id),
  'pg-食料費', '改名が反映される'
);
-- hana が同じカテゴリを個人範囲で使う
create temp table t2 as
select public.upsert_transaction(
  p_category_id => (select id from food),
  p_occurred_on => '2026-08-31'::date,
  p_amount => 500,
  p_payer_id => '22222222-2222-2222-2222-222222222222',
  p_owner_id => '22222222-2222-2222-2222-222222222222'
) as id;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select t.category_id from public.transactions t, t1 where t.id = t1.id),
  (select id from food), '改名しても取引の参照は切れない'
);

-- 列26 影響の件数は、自分から見えない範囲の分も数える
select is(
  ((select public.category_usage((select id from food)))->>'transactions')::int,
  2, '列26 影響件数は自分に見えない取引も数える'
);
select is(
  ((select public.category_usage((select id from food)))->>'others_transactions')::int,
  1, '列26 他人が作った取引の件数を返す'
);
select is(
  ((select public.category_usage((select id from food)))->>'others')::int,
  1, '列26 自分以外の何人が使っているかを返す'
);

-- 列23 他人が使っているカテゴリは削除できない。アーカイブへ誘導する
select throws_ok(
  $$ select public.delete_category((select id from food)) $$,
  'P0001', null, '列23 他人が使っているカテゴリは削除できない'
);
select lives_ok(
  $$ update public.categories set is_archived = true where id = (select id from food) $$,
  '列23 代わりにアーカイブはできる'
);

-- 未分類は全体で1つ。改名も削除もできない
select throws_ok(
  $$ update public.categories set name = 'その他' where is_system and kind = 'expense' $$,
  'P0001', null, '未分類は改名できない'
);
select throws_ok(
  $$ select public.delete_category(
       (select id from public.categories where is_system and kind = 'expense')) $$,
  'P0001', null, '未分類は削除できない'
);

select * from finish();
rollback;
