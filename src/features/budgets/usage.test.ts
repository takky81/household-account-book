import { describe, it, expect } from 'vitest';
import { buildBudgetRows, budgetUsage, scopeTotals } from './usage';

describe('budgetUsage', () => {
  it('列1 予算に届かないときは消化率と残額を出す', () => {
    expect(budgetUsage(20000, 8200)).toEqual({ rate: 0.41, remaining: 11800, over: false });
  });

  it('列2 予算を超えると残額が負になり超過として扱う', () => {
    expect(budgetUsage(55000, 62400)).toEqual({ rate: 62400 / 55000, remaining: -7400, over: true });
  });

  it('列3 予算が無いときは消化率を出さない', () => {
    expect(budgetUsage(null, 9400)).toEqual({ rate: null, remaining: null, over: false });
  });

  it('ちょうど使い切ったときは超過にしない', () => {
    expect(budgetUsage(120000, 120000)).toEqual({ rate: 1, remaining: 0, over: false });
  });
});

const categories = [
  { id: 'c1', shareGroupId: 'g1', ownerId: null, kind: 'expense' as const, name: '家賃', isArchived: false },
  { id: 'c2', shareGroupId: 'g1', ownerId: null, kind: 'expense' as const, name: '食費', isArchived: false },
  { id: 'c3', shareGroupId: null, ownerId: 'u1', kind: 'expense' as const, name: '交際費', isArchived: false },
  { id: 'c9', shareGroupId: 'g1', ownerId: null, kind: 'income' as const, name: '給与', isArchived: false },
];

const rows = () =>
  buildBudgetRows({
    categories,
    budgets: [
      { categoryId: 'c1', amount: 120000 },
      { categoryId: 'c2', amount: 55000 },
      { categoryId: 'c3', amount: 20000 },
    ],
    actuals: { c1: 120000, c2: 62400, c3: 8200 },
    selfBurden: { c1: 60000, c2: 31200, c3: 8200 },
  });

describe('buildBudgetRows', () => {
  it('列4 実績はそのカテゴリの支出総額で、自分の負担は参考値として持つ', () => {
    const 食費 = rows().find((r) => r.categoryId === 'c2')!;
    expect(食費.actual).toBe(62400);
    expect(食費.selfBurden).toBe(31200);
    expect(食費.over).toBe(true);
  });

  it('列5 収入カテゴリは行に出さない', () => {
    expect(rows().some((r) => r.categoryId === 'c9')).toBe(false);
  });

  it('列3 予算の無いカテゴリも実績つきで並べる', () => {
    const list = buildBudgetRows({
      categories,
      budgets: [],
      actuals: { c1: 9400 },
      selfBurden: { c1: 4700 },
    });
    const 家賃 = list.find((r) => r.categoryId === 'c1')!;
    expect(家賃.budget).toBeNull();
    expect(家賃.rate).toBeNull();
    expect(家賃.actual).toBe(9400);
  });
});

describe('scopeTotals', () => {
  it('列11 共有範囲ごとに予算と実績の合計を出す', () => {
    const totals = scopeTotals(rows());
    const group = totals.find((t) => t.shareGroupId === 'g1')!;
    expect(group.budget).toBe(175000);
    expect(group.actual).toBe(182400);
    expect(group.remaining).toBe(-7400);

    const own = totals.find((t) => t.ownerId === 'u1')!;
    expect(own.budget).toBe(20000);
    expect(own.actual).toBe(8200);
  });
});
