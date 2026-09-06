import { describe, it, expect } from 'vitest';
import {
  applyBudget,
  buildBudgetRows,
  budgetUsage,
  copyBudgets,
  scopeTotals,
  validateBudgetAmount,
} from './usage';

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
  { id: 'c1', parentId: null, shareGroupId: 'g1', ownerId: null, kind: 'expense' as const, name: '家賃', isArchived: false },
  { id: 'c2', parentId: null, shareGroupId: 'g1', ownerId: null, kind: 'expense' as const, name: '食費', isArchived: false },
  { id: 'c3', parentId: null, shareGroupId: null, ownerId: 'u1', kind: 'expense' as const, name: '交際費', isArchived: false },
  { id: 'c9', parentId: null, shareGroupId: 'g1', ownerId: null, kind: 'income' as const, name: '給与', isArchived: false },
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

describe('buildBudgetRows（小分類）', () => {
  const withChildren = [
    ...categories,
    { id: 'c2-eat', parentId: 'c2', shareGroupId: 'g1', ownerId: null, kind: 'expense' as const, name: '外食', isArchived: false },
    { id: 'c2-cook', parentId: 'c2', shareGroupId: 'g1', ownerId: null, kind: 'expense' as const, name: '自炊', isArchived: false },
  ];

  const list = () =>
    buildBudgetRows({
      categories: withChildren,
      budgets: [{ categoryId: 'c2', amount: 55000 }],
      actuals: { c2: 20000, 'c2-eat': 30000, 'c2-cook': 12400 },
      selfBurden: { c2: 10000, 'c2-eat': 15000, 'c2-cook': 6200 },
    });

  it('列12 小分類は予算の行に出さない', () => {
    expect(list().some((r) => r.categoryId === 'c2-eat')).toBe(false);
  });

  it('列13 実績は配下の小分類を含む', () => {
    const 食費 = list().find((r) => r.categoryId === 'c2')!;
    expect(食費.actual).toBe(20000 + 30000 + 12400);
    expect(食費.selfBurden).toBe(10000 + 15000 + 6200);
    expect(食費.over).toBe(true);
    expect(食費.remaining).toBe(55000 - 62400);
  });

  it('列13 小分類ごとの実績を内訳として持つ', () => {
    const 食費 = list().find((r) => r.categoryId === 'c2')!;
    expect(食費.children).toEqual([
      { categoryId: 'c2-eat', name: '外食', actual: 30000 },
      { categoryId: 'c2-cook', name: '自炊', actual: 12400 },
    ]);
  });

  it('列13 小分類の無い大分類は内訳を持たない', () => {
    const 家賃 = list().find((r) => r.categoryId === 'c1')!;
    expect(家賃.children).toEqual([]);
  });

  it('列11 共有範囲の合計を小分類で二重に数えない', () => {
    const group = scopeTotals(list()).find((t) => t.shareGroupId === 'g1')!;
    expect(group.actual).toBe(62400);
    expect(group.budget).toBe(55000);
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

describe('validateBudgetAmount', () => {
  it('列6 0円と負の予算は置けない', () => {
    expect(validateBudgetAmount(0).ok).toBe(false);
    expect(validateBudgetAmount(-1).ok).toBe(false);
  });

  it('1以上なら置ける', () => {
    expect(validateBudgetAmount(20000)).toEqual({ ok: true });
  });
});

describe('applyBudget', () => {
  it('列7 同じカテゴリ・同じ対象月なら上書きになる', () => {
    const before = [{ categoryId: 'c1', month: '2026-08-01', amount: 100000 }];
    const after = applyBudget(before, { categoryId: 'c1', month: '2026-08-01', amount: 120000 });
    expect(after).toEqual([{ categoryId: 'c1', month: '2026-08-01', amount: 120000 }]);
  });

  it('対象月が違えば別の行になる', () => {
    const before = [{ categoryId: 'c1', month: '2026-07-01', amount: 100000 }];
    const after = applyBudget(before, { categoryId: 'c1', month: '2026-08-01', amount: 120000 });
    expect(after).toHaveLength(2);
  });
});

describe('copyBudgets', () => {
  it('列9 前月の予算を当月に複製する', () => {
    const prev = [
      { categoryId: 'c1', month: '2026-07-01', amount: 120000 },
      { categoryId: 'c2', month: '2026-07-01', amount: 55000 },
    ];
    expect(copyBudgets(prev, '2026-08')).toEqual([
      { categoryId: 'c1', month: '2026-08-01', amount: 120000 },
      { categoryId: 'c2', month: '2026-08-01', amount: 55000 },
    ]);
  });

  it('列9 すでに当月にある予算は上書きしない', () => {
    const prev = [{ categoryId: 'c1', month: '2026-07-01', amount: 120000 }];
    const current = [{ categoryId: 'c1', month: '2026-08-01', amount: 130000 }];
    expect(copyBudgets(prev, '2026-08', current)).toEqual([]);
  });
});
