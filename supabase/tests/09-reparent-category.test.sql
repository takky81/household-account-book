-- カテゴリの親の付け替え
-- 決定表: カテゴリの管理 列27・列28・列29・列30・列31・列32・列33
begin;
select plan(13);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'reparent@example.com', 'x', now(), now());

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;

insert into public.categories (kind, name, sort_order) values
  ('expense', 'rp-食費', 10), ('expense', 'rp-交際費', 20), ('expense', 'rp-交通費', 30),
  ('income', 'rp-給与', 10);
insert into public.categories (parent_id, kind, name, sort_order)
select id, 'expense', 'rp-外食', 10 from public.categories where name = 'rp-食費';

select lives_ok(
  $$ select public.reparent_category(
       (select id from public.categories where name = 'rp-外食'),
       (select id from public.categories where name = 'rp-交際費')) $$,
  '列27 小分類を別の大分類へ付け替えられる'
);
select is(
  (select p.name from public.categories c join public.categories p on p.id = c.parent_id
    where c.name = 'rp-外食'),
  'rp-交際費', '列27 新しい親を指す'
);
select is(
  (select kind from public.categories where name = 'rp-外食'),
  'expense', '列27 収支区分は変わらない'
);

select lives_ok(
  $$ select public.reparent_category(
       (select id from public.categories where name = 'rp-外食'), null) $$,
  '列28 小分類を大分類へ戻せる'
);
select is(
  (select parent_id from public.categories where name = 'rp-外食'),
  null, '列28 親がなくなる'
);

insert into public.categories (parent_id, kind, name, sort_order)
select id, 'expense', 'rp-自炊', 20 from public.categories where name = 'rp-食費';
select throws_ok(
  $$ select public.reparent_category(
       (select id from public.categories where name = 'rp-食費'),
       (select id from public.categories where name = 'rp-交際費')) $$,
  'P0001', null, '列29 小分類を持つ大分類は小分類にできない'
);

insert into public.budgets (category_id, owner_id, month, amount)
select id, '11111111-1111-1111-1111-111111111111', '2026-09-01', 1000
  from public.categories where name = 'rp-交通費';
select throws_ok(
  $$ select public.reparent_category(
       (select id from public.categories where name = 'rp-交通費'),
       (select id from public.categories where name = 'rp-交際費')) $$,
  'P0001', null, '列30 予算がある大分類は小分類にできない'
);

select throws_ok(
  $$ select public.reparent_category(
       (select id from public.categories where name = 'rp-外食'),
       (select id from public.categories where name = 'rp-給与')) $$,
  'P0001', null, '列31 収支区分が異なる親へは移せない'
);

insert into public.categories (parent_id, kind, name, sort_order)
select id, 'expense', 'rp-外食', 10 from public.categories where name = 'rp-食費';
select throws_ok(
  $$ select public.reparent_category(
       (select id from public.categories where name = 'rp-外食' and parent_id is null),
       (select id from public.categories where name = 'rp-食費')) $$,
  '23505', null, '列32 同じ親の同名カテゴリとは衝突する'
);

select throws_ok(
  $$ select public.reparent_category(
       (select id from public.categories where name = 'rp-交通費'),
       (select id from public.categories where name = 'rp-外食' and parent_id is not null)) $$,
  'P0001', null, '列33 小分類の下へは移せない'
);

select throws_ok(
  $$ select public.reparent_category(
       (select id from public.categories where name = 'rp-交通費'),
       (select id from public.categories where is_system and kind = 'expense')) $$,
  'P0001', null, '列33 未分類の下へは移せない'
);

select ok(
  not has_column_privilege('authenticated', 'public.categories', 'parent_id', 'UPDATE'),
  'parent_id の直接更新権限は与えない'
);

select lives_ok(
  $$ select public.reparent_category(
       (select id from public.categories where name = 'rp-外食' and parent_id is null),
       (select id from public.categories where name = 'rp-交際費')) $$,
  '同じ名前が無ければ再び小分類にできる'
);

select * from finish();
rollback;
