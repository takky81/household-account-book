-- 定期登録（docs/仕様書.md §3.8 / §3.9 / §5.8）
-- 決定表: 定期登録ルールの管理 列1・列2・列3・列4・列5・列6・列7・列8・列9
-- 決定表: 定期登録の生成 列1・列2・列3・列4・列5・列6・列7・列8・列9・列10・列11・列12・列13・列14・列15
begin;
select plan(30);

-- 予定日の丸め。ロールを切り替える前に private の関数を直接確かめる（§5.8）
select is(
  private.recurring_due_date('2026-02-01'::date, 31), '2026-02-28'::date,
  '定期登録の生成 列8 31日指定の2月は末日になる'
);
select is(
  private.recurring_due_date('2026-01-01'::date, 31), '2026-01-31'::date,
  '定期登録の生成 列8 その月にある日はそのまま'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pg-taro@example.com', 'x', now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pg-hana@example.com', 'x', now(), now());

-- 対象月の基準。今日が何日でも支払日1日の予定は必ず期日を過ぎている
create temp table cal as select
  date_trunc('month', current_date)::date as m0,
  (date_trunc('month', current_date) - interval '1 month')::date as m1,
  (date_trunc('month', current_date) - interval '2 months')::date as m2,
  (date_trunc('month', current_date) + interval '1 month')::date as mn;

-- 花子（B）の個人カテゴリ。太郎（A）からは参照できないので、ここで控えておく
create temp table hana_own as
select c.id from public.categories c
 where c.owner_id = '22222222-2222-2222-2222-222222222222'
   and c.kind = 'expense' and c.is_system;

grant select on cal, hana_own to authenticated;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;

create temp table fx as
select public.create_share_group(
  'pg-夫婦',
  '[{"user_id":"11111111-1111-1111-1111-111111111111","default_weight":1,"sort_order":10},
    {"user_id":"22222222-2222-2222-2222-222222222222","default_weight":1,"sort_order":20}]'::jsonb
) as gid;

insert into public.categories (share_group_id, kind, name)
select fx.gid, 'expense', name
  from fx, (values ('家賃'), ('定期-停止'), ('定期-終了'), ('定期-未来'),
                   ('定期-手入力'), ('定期-アーカイブ'), ('定期-電気'), ('定期-水道')) as n(name);

insert into public.categories (share_group_id, kind, name) values (null, 'expense', '個人-サブスク');

create temp table cat as
select
  n.name,
  (select c.id from public.categories c, fx
    where c.share_group_id = fx.gid and c.name = n.name) as id
  from (values ('家賃'), ('定期-停止'), ('定期-終了'), ('定期-未来'),
               ('定期-手入力'), ('定期-アーカイブ'), ('定期-電気'), ('定期-水道')) as n(name);

create temp table own_cat as
select c.id from public.categories c
 where c.owner_id = '11111111-1111-1111-1111-111111111111' and c.name = '個人-サブスク';

-- ------------------------------------------------------- ルールの管理

select throws_ok(
  format($$ select public.upsert_recurring_rule(%L, 0, 1, %L) $$,
         (select id from cat where name = '家賃'), (select m0 from cal)),
  'P0001', null, '定期登録ルールの管理 列5 0円のルールは作れない'
);

select throws_ok(
  format($$ select public.upsert_recurring_rule(%L, 1000, 32, %L) $$,
         (select id from cat where name = '家賃'), (select m0 from cal)),
  'P0001', null, '定期登録ルールの管理 列4 支払日は1〜31だけ通す'
);

select throws_ok(
  format($$ select public.upsert_recurring_rule(%L, 1000, 1, %L, null, '', %L) $$,
         (select id from cat where name = '家賃'), (select m0 from cal), (select m1 from cal)),
  'P0001', null, '定期登録ルールの管理 列6 終了月が開始月より前なら弾く'
);

select throws_ok(
  format($$ select public.upsert_recurring_rule(%L, 1000, 1, %L, null, '', null, false,
             '[{"user_id":"11111111-1111-1111-1111-111111111111","amount":400},
               {"user_id":"22222222-2222-2222-2222-222222222222","amount":400}]'::jsonb) $$,
         (select id from cat where name = '家賃'), (select m0 from cal)),
  'P0001', null, '定期登録ルールの管理 列3 雛形の合計が金額と違えば弾く'
);

select throws_ok(
  format($$ select public.upsert_recurring_rule(%L, 1000, 1, %L, %L) $$,
         (select id from own_cat), (select m0 from cal),
         '22222222-2222-2222-2222-222222222222'),
  'P0001', null, '定期登録ルールの管理 列8 個人カテゴリの支払者は本人だけ'
);

select throws_ok(
  format($$ select public.upsert_recurring_rule(%L, 1000, 1, %L) $$,
         (select id from hana_own), (select m0 from cal)),
  'P0001', null, '定期登録ルールの管理 列7 参照できないカテゴリには作れない'
);

-- 正常系。自動按分のルールは雛形を持たない
create temp table rules as
select '家賃' as name, public.upsert_recurring_rule(
  (select id from cat where name = '家賃'), 120000, 1, (select m2 from cal),
  '11111111-1111-1111-1111-111111111111', '家賃'
) as id;

select is(
  (select r.splits_are_manual from public.recurring_rules r, rules where r.id = rules.id),
  false, '定期登録ルールの管理 列1 自動按分のルールは splits_are_manual が false'
);

insert into rules
select '定期-手入力', public.upsert_recurring_rule(
  (select id from cat where name = '定期-手入力'), 3000, 1, (select m0 from cal),
  null, '手で決めた負担', null, false,
  '[{"user_id":"11111111-1111-1111-1111-111111111111","amount":2000},
    {"user_id":"22222222-2222-2222-2222-222222222222","amount":1000}]'::jsonb
);

select is(
  (select array_agg(s.amount order by s.amount desc)
     from public.recurring_rule_splits s, rules
    where s.rule_id = rules.id and rules.name = '定期-手入力'),
  array[2000, 1000],
  '定期登録ルールの管理 列2 雛形は入力どおりに保存される'
);

-- 生成されないルールたち
insert into rules
select '定期-停止', public.upsert_recurring_rule(
  (select id from cat where name = '定期-停止'), 500, 1, (select m2 from cal),
  null, '', null, true);
insert into rules
select '定期-終了', public.upsert_recurring_rule(
  (select id from cat where name = '定期-終了'), 500, 1, (select m2 from cal),
  null, '', (select m2 from cal));
insert into rules
select '定期-未来', public.upsert_recurring_rule(
  (select id from cat where name = '定期-未来'), 500, 1, (select mn from cal));
insert into rules
select '定期-アーカイブ', public.upsert_recurring_rule(
  (select id from cat where name = '定期-アーカイブ'), 500, 1, (select m2 from cal));

update public.categories set is_archived = true
 where id = (select id from cat where name = '定期-アーカイブ');

-- --------------------------------------------------------------- 生成
--
-- 花子が開いても、太郎の作ったルールが太郎の入力として登録される（§2.7 の例外）

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

create temp table run1 as select public.run_recurring_rules() as result;

select is(
  (select (result->>'created')::int from run1), 5,
  '定期登録の生成 列1 期日の来た月ぶんだけ取引が作られる'
);

select is(
  (select count(*)::int from public.transactions t, cat
    where t.category_id = cat.id and cat.name = '家賃'),
  3, '定期登録の生成 列9 開かなかった月まで遡って作る'
);

select is(
  (select array_agg(distinct t.created_by) from public.transactions t, cat
    where t.category_id = cat.id and cat.name = '家賃'),
  array['11111111-1111-1111-1111-111111111111'::uuid],
  '定期登録の生成 列1 created_by はルールを作った人になる'
);

select is(
  (select count(*)::int from public.transactions t, cat
    where t.category_id = cat.id and cat.name = '定期-未来'),
  0, '定期登録の生成 列2 未来の予定は作らない'
);

select is(
  (select count(*)::int from public.transactions t, cat
    where t.category_id = cat.id and cat.name = '定期-未来'),
  0, '定期登録の生成 列7 開始月より前の対象月は作らない'
);

select is(
  (select count(*)::int from public.transactions t, cat
    where t.category_id = cat.id and cat.name = '定期-停止'),
  0, '定期登録の生成 列5 一時停止のルールは作らない'
);

select is(
  (select count(*)::int from public.transactions t, cat
    where t.category_id = cat.id and cat.name = '定期-終了'),
  1, '定期登録の生成 列6 終了月を過ぎた対象月は作らない'
);

select is(
  (select count(*)::int from public.transactions t, cat
    where t.category_id = cat.id and cat.name = '定期-アーカイブ'),
  0, '定期登録の生成 列12 アーカイブ済みカテゴリのルールは動かさない'
);

select is(
  (select array_agg(s.amount order by s.amount desc)
     from public.transaction_splits s
     join public.transactions t on t.id = s.transaction_id
     join cat on cat.id = t.category_id
    where cat.name = '定期-手入力'),
  array[2000, 1000],
  '定期登録の生成 列13 雛形の負担がそのまま複製される'
);

select is(
  (select array_agg(s.amount order by s.amount)
     from public.transaction_splits s
     join public.transactions t on t.id = s.transaction_id
     join cat on cat.id = t.category_id
    where cat.name = '家賃' and t.occurred_on = (select m0 from cal)),
  array[60000, 60000],
  '定期登録の生成 列14 自動按分は生成時の既定割合で決まる'
);

-- 二度目の起動では増えない
select is(
  (select (public.run_recurring_rules()->>'created')::int), 0,
  '定期登録の生成 列3 生成済みの対象月はもう作らない'
);

-- 生成分を消しても復活しない。生成済みかは取引の有無ではなく記録で決まる（§3.9）
delete from public.transactions t
 where t.id = (select p.transaction_id from public.recurring_postings p, rules
                where p.rule_id = rules.id and rules.name = '家賃'
                  and p.month = (select m0 from cal));

select is(
  (select (public.run_recurring_rules()->>'created')::int), 0,
  '定期登録の生成 列4 消した生成分は作り直さない'
);

select is(
  (select count(*)::int from public.recurring_postings p, rules
    where p.rule_id = rules.id and rules.name = '家賃'),
  3, '定期登録の生成 列4 取引を消しても生成の記録は残る'
);

-- 参照できないルールは他人の起動で動かない
create temp table hana_rule as
select public.upsert_recurring_rule(
  (select id from hana_own), 800, 1, (select m0 from cal),
  '22222222-2222-2222-2222-222222222222', '花子の定期'
) as id;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.run_recurring_rules();

select is(
  (select count(*)::int from public.recurring_postings p, hana_rule
    where p.rule_id = hana_rule.id),
  0, '定期登録の生成 列15 参照できないカテゴリのルールは動かさない'
);

-- 支払者が抜けても、他のルールは止まらない
insert into rules
select '定期-電気', public.upsert_recurring_rule(
  (select id from cat where name = '定期-電気'), 7000, 1, (select m0 from cal),
  '22222222-2222-2222-2222-222222222222', '電気');
insert into rules
select '定期-水道', public.upsert_recurring_rule(
  (select id from cat where name = '定期-水道'), 3000, 1, (select m0 from cal),
  null, '水道');

select public.remove_group_member(
  (select gid from fx), '22222222-2222-2222-2222-222222222222');

create temp table run2 as select public.run_recurring_rules() as result;

select is(
  (select count(*)::int from public.transactions t, cat
    where t.category_id = cat.id and cat.name = '定期-電気'),
  0, '定期登録の生成 列10 支払者が抜けたルールは登録できない'
);

select is(
  (select count(*)::int from public.transactions t, cat
    where t.category_id = cat.id and cat.name = '定期-水道'),
  1, '定期登録の生成 列10 1件の失敗で他の固定費は止まらない'
);

select ok(
  (select (result->>'failed')::int from run2) >= 1
  and (select result->'failures'->0->>'rule_id' from run2) is not null,
  '定期登録の生成 列10 失敗したルールを返す'
);

-- 生成の記録は手で書けない（同じ対象月に二度作らせないための唯一の記録）
select throws_ok(
  format($$ insert into public.recurring_postings (rule_id, month) values (%L, %L) $$,
         (select id from rules where name = '家賃'), (select m0 from cal)),
  '42501', null, '定期登録の生成 列11 生成の記録は直接 INSERT できない'
);

-- ルールを消しても、作った取引は残る
delete from public.recurring_rules r where r.id = (select id from rules where name = '家賃');

select is(
  (select count(*)::int from public.transactions t, cat
    where t.category_id = cat.id and cat.name = '家賃'),
  2, '定期登録ルールの管理 列9 ルールを消しても生成した取引は残る'
);

set local role postgres;
select is(
  (select count(*)::int from public.recurring_postings p, rules
    where p.rule_id = rules.id and rules.name = '家賃'),
  0, '定期登録ルールの管理 列9 雛形と生成の記録はカスケードで消える'
);

select * from finish();
rollback;
