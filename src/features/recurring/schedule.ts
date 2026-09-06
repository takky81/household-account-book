/**
 * 定期登録の予定日と対象月（決定表「定期登録の生成」／docs/仕様書.md §5.8）。
 *
 * 同じ規則は DB 側（private.recurring_due_date と run_recurring_rules）にもある。
 * ここは画面に次回の予定を出すためのもの。片方だけ直すとずれる。
 */

import { addMonths, monthEnd, monthKeyOf } from '../../lib/date';

export type ScheduleRule = {
  /** 支払日。1〜31 */
  dayOfMonth: number;
  /** 生成を始める対象月（YYYY-MM） */
  startMonth: string;
  /** 生成を終える対象月。null は無期限 */
  endMonth: string | null;
  isPaused: boolean;
};

/** その対象月の予定日。月に無い日（2月31日など）は月末日へ丸める。 */
export function dueDate(monthKey: string, dayOfMonth: number): string {
  const day = `${monthKey}-${String(dayOfMonth).padStart(2, '0')}`;
  const end = monthEnd(monthKey);
  return day > end ? end : day;
}

/**
 * まだ生成しておらず、予定日が今日以前になっている対象月を古い順に返す。
 * 未来の予定は返さない（先に入れると、まだ払っていない支出が集計に現れる）。
 */
export function pendingMonths(
  rule: ScheduleRule,
  postedMonths: readonly string[],
  today: string,
): string[] {
  if (rule.isPaused) return [];
  const posted = new Set(postedMonths);
  const last = monthKeyOf(today);
  const months: string[] = [];
  for (let month = rule.startMonth; month <= last; month = addMonths(month, 1)) {
    if (rule.endMonth !== null && month > rule.endMonth) break;
    // 予定日は月が進むほど後になるので、未来に届いたらこのルールは終わり
    if (dueDate(month, rule.dayOfMonth) > today) break;
    if (!posted.has(month)) months.push(month);
  }
  return months;
}

/**
 * 次に登録される予定日。終わっている・止まっているルールは null。
 * 候補は今月と来月しかない（今月の予定日を過ぎていれば来月）。
 */
export function nextDueDate(rule: ScheduleRule, today: string): string | null {
  if (rule.isPaused) return null;
  const thisMonth = monthKeyOf(today);
  let month = rule.startMonth > thisMonth ? rule.startMonth : thisMonth;
  for (let i = 0; i < 2; i += 1) {
    if (rule.endMonth !== null && month > rule.endMonth) return null;
    const due = dueDate(month, rule.dayOfMonth);
    if (due > today) return due;
    month = addMonths(month, 1);
  }
  return null;
}

/** 実行の結果を1行で伝える（§5.8）。黙って増やすと、覚えのない取引が並んだように見える。 */
export type RunSummary = { created: number; failed: number };

export function describeRecurringRun(result: RunSummary): string {
  const parts: string[] = [];
  if (result.created > 0) parts.push(`定期登録から${result.created}件を登録しました`);
  if (result.failed > 0) parts.push(`${result.failed}件は登録できませんでした`);
  if (parts.length === 0) return '登録する定期登録はありませんでした';
  return parts.join('。');
}
