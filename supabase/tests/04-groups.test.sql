-- 共有グループの管理のうち、画面からは作れない状況（docs/仕様書.md §2.7 / §3.3）
begin;
select plan(6);

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

-- 決定表: 共有グループの管理 列3
select throws_ok(
  $$select public.create_share_group(
      '夫婦',
      '[{"user_id":"11111111-1111-1111-1111-111111111111","default_weight":1,"sort_order":10},
        {"user_id":"99999999-9999-9999-9999-999999999999","default_weight":1,"sort_order":20}]'::jsonb
    )$$,
  '存在しない利用者が含まれています',
  '存在しない利用者を含むグループは作れない'
);
select is(
  (select count(*)::int from public.share_groups), 0,
  '弾かれたときはグループも残らない'
);

create temp table fx as
select public.create_share_group(
  '夫婦',
  '[{"user_id":"11111111-1111-1111-1111-111111111111","default_weight":1,"sort_order":10},
    {"user_id":"22222222-2222-2222-2222-222222222222","default_weight":1,"sort_order":20}]'::jsonb
) as gid;

-- 決定表: 共有グループの管理 列8
-- メンバーでない other からは、グループの存在を知っていても足せない
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select throws_ok(
  format(
    $$select public.add_group_member(%L, '33333333-3333-3333-3333-333333333333')$$,
    (select gid from fx)
  ),
  'そのグループのメンバーではありません',
  '非メンバーは自分をグループに足せない'
);
-- 決定表: 共有グループの管理 列8
select throws_ok(
  format($$select public.delete_share_group(%L)$$, (select gid from fx)),
  'そのグループのメンバーではありません',
  '非メンバーはグループを消せない'
);

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
-- 決定表: 共有グループの管理 列7
select throws_ok(
  format(
    $$select public.add_group_member(%L, '22222222-2222-2222-2222-222222222222')$$,
    (select gid from fx)
  ),
  'すでにメンバーです',
  '同じ人は二重に足せない'
);
-- 決定表: 共有グループの管理 列10
select throws_ok(
  format(
    $$select public.remove_group_member(%L, '22222222-2222-2222-2222-222222222222');
      select public.remove_group_member(%L, '11111111-1111-1111-1111-111111111111')$$,
    (select gid from fx), (select gid from fx)
  ),
  '最後のメンバーは外せません',
  '最後の1人は外せない'
);

select * from finish();
rollback;
