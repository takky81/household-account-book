-- 利用者の初期化・按分・参照範囲（docs/仕様書.md §3.1 / §5.1 / §2.4）
begin;
select plan(12);

-- 決定表: 共有グループの管理 列1
-- 決定表: 負担の按分 列1・列6
-- 決定表: アクセス制御 列1
-- 利用者を3人作る。トリガが profiles を作る（未分類は全体で2件なので利用者ごとには作らない）
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

-- カテゴリは全ユーザー共通。未分類は収支区分ごとに1件で、利用者を増やしても増えない
select is(
  (select count(*)::int from public.categories where is_system), 2,
  '未分類は全体で収入・支出の2件だけ'
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
  'pg-夫婦',
  '[{"user_id":"11111111-1111-1111-1111-111111111111","default_weight":1,"sort_order":10},
    {"user_id":"22222222-2222-2222-2222-222222222222","default_weight":1,"sort_order":20}]'::jsonb
) as gid;

select is(
  (select count(*)::int from public.share_group_members m, fx where m.share_group_id = fx.gid), 2,
  'グループを作るとメンバーが登録される（未分類は共通なので作らない）'
);

insert into public.categories (kind, name, sort_order) values ('expense', 'pg-家賃', 10);

-- 1001 円を折半すると 501 と 500。端数は重みの大きい順、同じなら sort_order 昇順
create temp table tx as
select public.upsert_transaction(
  p_category_id => (select id from public.categories where name = 'pg-家賃'),
  p_occurred_on => '2026-08-31'::date,
  p_amount => 1001,
  p_payer_id => '11111111-1111-1111-1111-111111111111',
  p_memo => '8月分',
  p_share_group_id => (select gid from fx)
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

-- 個人の共有範囲の取引は本人1行。カテゴリは共通のものをそのまま使う
create temp table ptx as
select public.upsert_transaction(
  p_category_id => (select id from public.categories where is_system and kind = 'expense'),
  p_occurred_on => '2026-08-31'::date,
  p_amount => 780,
  p_payer_id => '11111111-1111-1111-1111-111111111111',
  p_memo => '昼食',
  p_owner_id => '11111111-1111-1111-1111-111111111111'
) as id;

select is(
  (select count(*)::int from public.transaction_splits s, ptx where s.transaction_id = ptx.id),
  1, '個人の共有範囲の負担は本人1行'
);

-- 同じグループの hana からは見える
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from public.transactions), 1,
  '同じグループのメンバーには共有の取引が見える（個人の取引は見えない）'
);

-- 属していない other からは取引が見えない。ただしカテゴリは全員共通なので見える
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is(
  (select count(*)::int from public.transactions), 0,
  '属さないグループの取引は見えない'
);
select is(
  (select count(*)::int from public.categories where name = 'pg-家賃'), 1,
  'カテゴリは全ユーザー共通なので、グループに属さない人にも見える'
);

select * from finish();
rollback;
