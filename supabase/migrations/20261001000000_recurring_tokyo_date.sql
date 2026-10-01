-- 定期登録の「今日」は対象月と同じ Asia/Tokyo の日付で判定する（§5.3 / §5.8）。
-- DB セッションの current_date は UTC になり得るため、日本時間の月初に当月分を落としていた。

create or replace function private.local_date(p_at timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select (p_at at time zone 'Asia/Tokyo')::date;
$$;

create or replace function public.run_recurring_rules(p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local_today date;
  v_today date; v_rule record; v_month date; v_last date; v_due date;
  v_splits jsonb; v_tag_ids jsonb; v_tx uuid; v_claimed uuid;
  v_created int := 0; v_failed int := 0; v_failures jsonb := '[]'::jsonb;
begin
  perform public.require_uid();
  v_local_today := private.local_date(current_timestamp);
  v_today := least(coalesce(p_today, v_local_today), v_local_today);
  v_last := date_trunc('month', v_today)::date;
  for v_rule in
    select r.* from public.recurring_rules r join public.categories c on c.id = r.category_id
     where not r.is_paused and not c.is_archived
       and (r.owner_id = auth.uid() or r.share_group_id in (select private.accessible_group_ids()))
     order by r.created_at, r.id
  loop
    v_month := v_rule.start_month;
    while v_month <= v_last loop
      exit when v_rule.end_month is not null and v_month > v_rule.end_month;
      v_due := private.recurring_due_date(v_month, v_rule.day_of_month);
      exit when v_due > v_today;
      begin
        v_claimed := null;
        insert into public.recurring_postings (rule_id, month) values (v_rule.id, v_month)
        on conflict do nothing returning rule_id into v_claimed;
        if v_claimed is not null then
          if v_rule.splits_are_manual then
            select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'amount', s.amount))
              into v_splits from public.recurring_rule_splits s where s.rule_id = v_rule.id;
          else v_splits := null; end if;
          select coalesce(jsonb_agg(rt.tag_id order by rt.tag_id), '[]'::jsonb)
            into v_tag_ids from public.recurring_rule_tags rt where rt.rule_id = v_rule.id;
          v_tx := public.upsert_transaction(
            p_category_id => v_rule.category_id, p_occurred_on => v_due,
            p_amount => v_rule.amount, p_payer_id => v_rule.payer_id, p_memo => v_rule.memo,
            p_splits => v_splits, p_share_group_id => v_rule.share_group_id,
            p_owner_id => v_rule.owner_id, p_tag_ids => v_tag_ids
          );
          update public.transactions t set created_by = v_rule.created_by where t.id = v_tx;
          update public.recurring_postings p set transaction_id = v_tx
           where p.rule_id = v_rule.id and p.month = v_month;
          v_created := v_created + 1;
        end if;
      exception when others then
        v_failed := v_failed + 1;
        v_failures := v_failures || jsonb_build_object(
          'rule_id', v_rule.id, 'month', to_char(v_month, 'YYYY-MM'), 'message', sqlerrm
        );
        exit;
      end;
      v_month := (v_month + interval '1 month')::date;
    end loop;
  end loop;
  return jsonb_build_object('created', v_created, 'failed', v_failed, 'failures', v_failures);
end;
$$;

revoke all on function private.local_date(timestamptz) from public, anon, authenticated;
