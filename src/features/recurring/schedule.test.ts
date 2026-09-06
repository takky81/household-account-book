import { describe, it, expect } from 'vitest';
import {
  describeRecurringRun,
  dueDate,
  nextDueDate,
  pendingMonths,
  type ScheduleRule,
} from './schedule';

const rule = (patch: Partial<ScheduleRule> = {}): ScheduleRule => ({
  dayOfMonth: 1,
  startMonth: '2026-01',
  endMonth: null,
  isPaused: false,
  ...patch,
});

describe('dueDate', () => {
  it('列8 31日指定の2月は末日になる', () => {
    expect(dueDate('2026-02', 31)).toBe('2026-02-28');
  });

  it('うるう年は29日になる', () => {
    expect(dueDate('2028-02', 31)).toBe('2028-02-29');
  });

  it('その月にある日はそのまま', () => {
    expect(dueDate('2026-01', 31)).toBe('2026-01-31');
    expect(dueDate('2026-04', 5)).toBe('2026-04-05');
  });
});

describe('pendingMonths', () => {
  it('列1 期日の来た対象月を返す', () => {
    expect(pendingMonths(rule({ startMonth: '2026-03' }), [], '2026-03-10')).toEqual(['2026-03']);
  });

  it('列9 未生成の月を古い順にすべて返す', () => {
    expect(pendingMonths(rule(), [], '2026-03-10')).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('列2 未来の予定は返さない', () => {
    // 支払日 25 日。今日が 10 日なら今月ぶんはまだ期日が来ていない
    expect(pendingMonths(rule({ dayOfMonth: 25 }), [], '2026-03-10')).toEqual([
      '2026-01',
      '2026-02',
    ]);
  });

  it('列3 生成済みの月は返さない', () => {
    expect(pendingMonths(rule(), ['2026-01', '2026-03'], '2026-03-10')).toEqual(['2026-02']);
  });

  it('列5 一時停止のルールは返さない', () => {
    expect(pendingMonths(rule({ isPaused: true }), [], '2026-03-10')).toEqual([]);
  });

  it('列6 終了月を過ぎたら返さない', () => {
    expect(pendingMonths(rule({ endMonth: '2026-02' }), [], '2026-03-10')).toEqual([
      '2026-01',
      '2026-02',
    ]);
  });

  it('列7 開始月より前は返さない', () => {
    expect(pendingMonths(rule({ startMonth: '2026-04' }), [], '2026-03-10')).toEqual([]);
  });

  it('列8 31日指定でも、その月の末日を過ぎていれば返す', () => {
    expect(
      pendingMonths(rule({ dayOfMonth: 31, startMonth: '2026-02' }), [], '2026-02-28'),
    ).toEqual(['2026-02']);
  });
});

describe('nextDueDate', () => {
  it('今月の予定日がまだなら今月を返す', () => {
    expect(nextDueDate(rule({ dayOfMonth: 25 }), '2026-03-10')).toBe('2026-03-25');
  });

  it('今月の予定日を過ぎていれば来月を返す', () => {
    expect(nextDueDate(rule(), '2026-03-10')).toBe('2026-04-01');
  });

  it('開始月がまだ先ならその月を返す', () => {
    expect(nextDueDate(rule({ startMonth: '2026-06' }), '2026-03-10')).toBe('2026-06-01');
  });

  it('列6 終了月を過ぎたルールは次回を持たない', () => {
    expect(nextDueDate(rule({ endMonth: '2026-03' }), '2026-03-10')).toBeNull();
  });

  it('列5 一時停止のルールは次回を持たない', () => {
    expect(nextDueDate(rule({ isPaused: true }), '2026-03-10')).toBeNull();
  });
});

describe('describeRecurringRun', () => {
  it('列1 生成した件数を知らせる', () => {
    expect(describeRecurringRun({ created: 3, failed: 0 })).toBe('定期登録から3件を登録しました');
  });

  it('列10 失敗した件数も並べて知らせる', () => {
    expect(describeRecurringRun({ created: 1, failed: 2 })).toBe(
      '定期登録から1件を登録しました。2件は登録できませんでした',
    );
  });

  it('何も無ければ、無かったと伝える', () => {
    expect(describeRecurringRun({ created: 0, failed: 0 })).toBe(
      '登録する定期登録はありませんでした',
    );
  });
});
