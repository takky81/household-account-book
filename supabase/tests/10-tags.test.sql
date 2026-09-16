-- タグ（docs/仕様書.md §3.5.1 / §5.4）
begin;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pg-tag-taro@example.com', 'x', now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pg-tag-hana@example.com', 'x', now(), now()),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pg-tag-other@example.com', 'x', now(), now());

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;

create temp table fx as
select public.create_share_group(
  'pg-tag-夫婦',
  '[{"user_id":"11111111-1111-1111-1111-111111111111","default_weight":1,"sort_order":10},
    {"user_id":"22222222-2222-2222-2222-222222222222","default_weight":1,"sort_order":20}]'::jsonb
) as gid;
grant select on fx to authenticated;

insert into public.categories (kind, name) values ('expense', 'pg-tag-交通費');
insert into public.tags (name, color, sort_order)
values ('pg-旅行', '#0ea5e9', 10), ('pg-家族', '#f97316', 20);

select is((select count(*)::int from public.tags where name like 'pg-%'), 2,
  'タグは全ユーザー共通のマスタとして作れる');

create temp table tx as
select public.upsert_transaction(
  p_category_id => (select id from public.categories where name = 'pg-tag-交通費'),
  p_occurred_on => current_date,
  p_amount => 2000,
  p_payer_id => '11111111-1111-1111-1111-111111111111',
  p_share_group_id => (select gid from fx),
  p_tag_ids => (select jsonb_agg(id order by name) from public.tags where name like 'pg-%')
) as id;
grant select on tx to authenticated;

select is((select count(*)::int from public.transaction_tags tt, tx where tt.transaction_id = tx.id), 2,
  '取引の入力と編集 列21 複数タグを取引・負担とまとめて保存する');

select throws_ok(
  format($$ select public.upsert_transaction(%L, current_date, 100, %L,
    p_owner_id => %L, p_tag_ids => %L::jsonb) $$,
    (select id from public.categories where name = 'pg-tag-交通費'),
    '11111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111',
    jsonb_build_array((select id from public.tags where name = 'pg-旅行'),
                      (select id from public.tags where name = 'pg-旅行'))),
  'P0001', null, '同じタグを2回指定できない'
);

select throws_ok(
  format($$ select public.upsert_transaction(%L, current_date, 100, %L,
    p_owner_id => %L, p_tag_ids => '["99999999-9999-9999-9999-999999999999"]'::jsonb) $$,
    (select id from public.categories where name = 'pg-tag-交通費'),
    '11111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111'),
  'P0001', null, '存在しないタグを指定できない'
);

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.transaction_tags), 2,
  '同じグループのメンバーは取引のタグを読める');

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.transaction_tags), 0,
  '非メンバーには取引のタグを見せない');
select throws_ok(
  $$ insert into public.transaction_tags (transaction_id, tag_id)
     select tx.id, t.id from tx cross join public.tags t limit 1 $$,
  '42501', null, '紐付けはテーブルへ直接書けない'
);

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.upsert_recurring_rule(
  p_category_id => (select id from public.categories where name = 'pg-tag-交通費'),
  p_amount => 500, p_day_of_month => 1,
  p_start_month => date_trunc('month', current_date)::date,
  p_payer_id => '11111111-1111-1111-1111-111111111111',
  p_memo => 'pg-tag-定期',
  p_owner_id => '11111111-1111-1111-1111-111111111111',
  p_tag_ids => jsonb_build_array((select id from public.tags where name = 'pg-旅行'))
);

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.recurring_rule_tags), 0,
  '非メンバーには定期登録ルールのタグを見せない');

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.run_recurring_rules();
select is(
  (select t.name from public.transactions x
     join public.transaction_tags tt on tt.transaction_id = x.id
     join public.tags t on t.id = tt.tag_id
    where x.memo = 'pg-tag-定期'),
  'pg-旅行', '定期登録の生成 列17 ルールのタグを生成した取引へ引き継ぐ'
);

select * from finish();
rollback;
