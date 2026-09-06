import { describe, it, expect } from 'vitest';
import { validateRecurringRule, type RecurringRuleInput } from './validation';

const input = (patch: Partial<RecurringRuleInput> = {}): RecurringRuleInput => ({
  categoryId: 'c1',
  amount: 120000,
  dayOfMonth: 1,
  startMonth: '2026-03',
  endMonth: null,
  ...patch,
});

describe('validateRecurringRule', () => {
  it('列1 期日と金額が整っていれば通す', () => {
    expect(validateRecurringRule(input())).toEqual({ ok: true });
  });

  it('列2 雛形の合計が一致すれば通す', () => {
    expect(
      validateRecurringRule(
        input({
          splits: [
            { userId: 'u1', amount: 70000 },
            { userId: 'u2', amount: 50000 },
          ],
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('列3 雛形の合計が金額と違えば弾く', () => {
    const result = validateRecurringRule(
      input({
        splits: [
          { userId: 'u1', amount: 70000 },
          { userId: 'u2', amount: 40000 },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('列3 同じ人が2回現れたら弾く', () => {
    const result = validateRecurringRule(
      input({
        splits: [
          { userId: 'u1', amount: 60000 },
          { userId: 'u1', amount: 60000 },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('列4 支払日は1〜31だけ通す', () => {
    expect(validateRecurringRule(input({ dayOfMonth: 0 })).ok).toBe(false);
    expect(validateRecurringRule(input({ dayOfMonth: 32 })).ok).toBe(false);
    expect(validateRecurringRule(input({ dayOfMonth: 31 })).ok).toBe(true);
  });

  it('列5 0円や小数は弾く', () => {
    expect(validateRecurringRule(input({ amount: 0 })).ok).toBe(false);
    expect(validateRecurringRule(input({ amount: -100 })).ok).toBe(false);
    expect(validateRecurringRule(input({ amount: 1.5 })).ok).toBe(false);
  });

  it('列6 終了月が開始月より前なら弾く', () => {
    expect(validateRecurringRule(input({ endMonth: '2026-02' })).ok).toBe(false);
    expect(validateRecurringRule(input({ endMonth: '2026-03' })).ok).toBe(true);
  });

  it('列7 カテゴリが選ばれていなければ弾く', () => {
    expect(validateRecurringRule(input({ categoryId: '' })).ok).toBe(false);
  });
});
