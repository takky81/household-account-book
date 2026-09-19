-- 不足物資（docs/仕様書.md §3.5.2）
begin;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pg-supply-taro@example.com', 'x', now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pg-supply-hana@example.com', 'x', now(), now());

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;

insert into public.missing_supplies (name) values ('トイレットペーパー');

select is((select count(*)::int from public.missing_supplies), 1,
  '不足物資 列3 ログイン済みの利用者は不足物資を追加できる');
select is(
  (select created_by from public.missing_supplies where name = 'トイレットペーパー'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  '作成者は呼び出し元から自動設定される'
);
select throws_ok(
  $$ insert into public.missing_supplies (name) values ('') $$,
  '23514', null, '空の名前は登録できない'
);
select throws_ok(
  $$ insert into public.missing_supplies (name, created_by)
     values ('偽装', '22222222-2222-2222-2222-222222222222') $$,
  '42501', null, '作成者を偽装できない'
);

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.missing_supplies), 1,
  '不足物資 列3 別のログイン利用者にも同じ不足物資が見える');

update public.missing_supplies set is_purchased = true where name = 'トイレットペーパー';
select ok(
  (select is_purchased from public.missing_supplies where name = 'トイレットペーパー'),
  '不足物資 列3 別のログイン利用者が購入済みにできる'
);

delete from public.missing_supplies where name = 'トイレットペーパー';
select is((select count(*)::int from public.missing_supplies), 0,
  '不足物資 列3 ログイン利用者が削除できる');

set local role anon;
select throws_ok(
  $$ select * from public.missing_supplies $$,
  '42501', null, '不足物資 列4 未ログインでは参照できない'
);
select throws_ok(
  $$ insert into public.missing_supplies (name) values ('牛乳') $$,
  '42501', null, '不足物資 列4 未ログインでは追加できない'
);

select * from finish();
rollback;
