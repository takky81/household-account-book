-- 利用者の初期化・按分・参照範囲（docs/仕様書.md §3.1 / §5.1 / §2.4）
begin;
select plan(12);

-- 決定表: 共有グループの管理 列1
-- 決定表: 負担の按分 列1・列6
-- 決定表: アクセス制御 列1
-- 利用者を3人作る。トリガが profiles と個人用の未分類を作る
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pg-taro@example.com', 'x', now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pg-hana@example.com', 'x', now(), now()),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pg-other@example.com', 'x', now(), now());

-- E2E 用の利用者が同じ DB に残っていることがあるので、この3人だけを数える
select is(
  (select count(*)::int from public.profiles
    where id in ('11111111-1111-1111-1111-111111111111',
                 '22222222-2222-2222-2222-222222222222',
                 '33333333-3333-3333-3333-333333333333')), 3,
  '利用者を作ると profiles ができる'
);
select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'pg-taro', '表示名の初期値はメールのローカル部'
);
select is(
  (select count(*)::int from public.categories
    where owner_id = '11111111-1111-1111-1111-111111111111' and is_system), 2,
  '個人用の未分類が収入・支出の2件できる'
);

-- 同じローカル部の2人目は連番が付く（一意制約で利用者作成ごと失敗させない）
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'pg-taro@other.example.com', 'x', now(), now());
select is(
  (select display_name from public.profiles where id = '44444444-4444-4444-4444-444444444444'),
  'pg-taro-2', '表示名が重なると連番を付ける'
);

-- ここから taro として操作する
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;

create temp table fx as
select public.create_share_group(
  '夫婦',
  '[{"user_id":"11111111-1111-1111-1111-111111111111","default_weight":1,"sort_order":10},
    {"user_id":"22222222-2222-2222-2222-222222222222","default_weight":1,"sort_order":20}]'::jsonb
) as gid;

select is(
  (select count(*)::int from public.categories c, fx
    where c.share_group_id = fx.gid and c.is_system), 2,
  'グループを作ると未分類が収入・支出の2件できる'
);

insert into public.categories (share_group_id, kind, name, sort_order)
select fx.gid, 'expense', '家賃', 10 from fx;

-- 1001 円を折半すると 501 と 500。端数は重みの大きい順、同じなら sort_order 昇順
create temp table tx as
select public.upsert_transaction(
  (select c.id from public.categories c, fx where c.share_group_id = fx.gid and c.name = '家賃'),
  '2026-08-31'::date, 1001, '11111111-1111-1111-1111-111111111111', '8月分'
) as id;

select is(
  (select sum(s.amount)::int from public.transaction_splits s, tx where s.transaction_id = tx.id),
  1001, '負担の合計は金額に一致する'
);
select is(
  (select s.amount from public.transaction_splits s, tx
    where s.transaction_id = tx.id and s.user_id = '11111111-1111-1111-1111-111111111111'),
  501, '端数は sort_order の早いメンバーに寄る'
);
select is(
  (select s.amount from public.transaction_splits s, tx
    where s.transaction_id = tx.id and s.user_id = '22222222-2222-2222-2222-222222222222'),
  500, 'もう一方は 500'
);

-- 個人カテゴリの取引は本人1行
create temp table ptx as
select public.upsert_transaction(
  (select c.id from public.categories c
    where c.owner_id = '11111111-1111-1111-1111-111111111111' and c.kind = 'expense' and c.is_system),
  '2026-08-31'::date, 780, '11111111-1111-1111-1111-111111111111', '昼食'
) as id;

select is(
  (select count(*)::int from public.transaction_splits s, ptx where s.transaction_id = ptx.id),
  1, '個人カテゴリの負担は本人1行'
);

-- 同じグループの hana からは見える
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from public.transactions), 1,
  '同じグループのメンバーには共有の取引が見える（個人の取引は見えない）'
);

-- 属していない other からは存在ごと見えない
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is(
  (select count(*)::int from public.transactions), 0,
  '属さないグループの取引は見えない'
);
select is(
  (select count(*)::int from public.categories where name = '家賃'), 0,
  '属さないグループのカテゴリは見えない'
);

select * from finish();
rollback;
