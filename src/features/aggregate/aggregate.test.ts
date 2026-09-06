import { describe, it, expect } from 'vitest';
import {
  NO_SUBCATEGORY,
  PIE_COLORS,
  SHARED_PAYER,
  aggregateMonth,
  categorySlices,
  monthDiff,
  targetUsers,
  type AggregateTx,
  type CategoryTotal,
} from './aggregate';

const 夫婦 = 'g1';
const taro = 'u1';
const hana = 'u2';

/** 夫婦の家賃 120,000 を共用の財布から出し、折半で負担した */
const rent: AggregateTx = {
  id: 't1',
  occurredOn: '2026-08-31',
  categoryId: 'c-rent',
  categoryName: '家賃',
  kind: 'expense',
  shareGroupId: 夫婦,
  ownerId: null,
  amount: 120000,
  payerId: null,
  splits: [
    { userId: taro, amount: 60000 },
    { userId: hana, amount: 60000 },
  ],
};

/** 夫婦の食費 4,200 を はなこ が払い、折半で負担した */
const food: AggregateTx = {
  id: 't2',
  occurredOn: '2026-08-31',
  categoryId: 'c-food-shared',
  categoryName: '食費',
  kind: 'expense',
  shareGroupId: 夫婦,
  ownerId: null,
  amount: 4200,
  payerId: hana,
  splits: [
    { userId: taro, amount: 2100 },
    { userId: hana, amount: 2100 },
  ],
};

/** たかしの個人の食費 780 */
const lunch: AggregateTx = {
  id: 't3',
  occurredOn: '2026-08-31',
  categoryId: 'c-food-own',
  categoryName: '食費',
  kind: 'expense',
  shareGroupId: null,
  ownerId: taro,
  amount: 780,
  payerId: taro,
  splits: [{ userId: taro, amount: 780 }],
};

/** 先月の取引（前月比に使う） */
const lastMonth: AggregateTx = {
  ...rent,
  id: 't0',
  occurredOn: '2026-07-31',
  amount: 100000,
  splits: [
    { userId: taro, amount: 50000 },
    { userId: hana, amount: 50000 },
  ],
};

const all = [rent, food, lunch, lastMonth];
const members = { [夫婦]: [taro, hana] };

describe('targetUsers', () => {
  it('列1 自分に関わるすべてでは自分だけを数える', () => {
    expect(targetUsers({ kind: 'all' }, taro, members)).toEqual([taro]);
  });

  it('列2 グループを見るときはメンバー全員を数える', () => {
    expect(targetUsers({ kind: 'group', shareGroupId: 夫婦 }, taro, members)).toEqual([taro, hana]);
  });

  it('列5 個人のみでは自分だけを数える', () => {
    expect(targetUsers({ kind: 'own' }, taro, members)).toEqual([taro]);
  });
});

describe('aggregateMonth', () => {
  it('列1 負担額基準では自分の負担を合計する（個人の取引も含む）', () => {
    const result = aggregateMonth({
      transactions: all,
      monthKey: '2026-08',
      scope: { kind: 'all' },
      basis: 'burden',
      selfId: taro,
      members,
    });
    expect(result.expense).toBe(60000 + 2100 + 780);
    expect(result.income).toBe(0);
    expect(result.balance).toBe(-(60000 + 2100 + 780));
  });

  it('列2 グループを負担額で見るとグループの支出総額に一致する', () => {
    const result = aggregateMonth({
      transactions: all,
      monthKey: '2026-08',
      scope: { kind: 'group', shareGroupId: 夫婦 },
      basis: 'burden',
      selfId: taro,
      members,
    });
    expect(result.expense).toBe(120000 + 4200);
  });

  it('列3 支払額基準でも合計は同じで、共用は1つの枠にまとまる', () => {
    const result = aggregateMonth({
      transactions: all,
      monthKey: '2026-08',
      scope: { kind: 'group', shareGroupId: 夫婦 },
      basis: 'payment',
      selfId: taro,
      members,
    });
    expect(result.expense).toBe(120000 + 4200);
    expect(result.byUser).toEqual([
      { userId: SHARED_PAYER, amount: 120000 },
      { userId: hana, amount: 4200 },
      { userId: taro, amount: 0 },
    ]);
  });

  it('列4 支払額基準の「自分に関わるすべて」には共用の取引が入らない', () => {
    const result = aggregateMonth({
      transactions: all,
      monthKey: '2026-08',
      scope: { kind: 'all' },
      basis: 'payment',
      selfId: taro,
      members,
    });
    // 家賃は共用払いなので誰にも属さない。自分の支払いは個人の 780 だけ
    expect(result.expense).toBe(780);
  });

  it('列5 個人のみでは共有カテゴリの取引が出ない', () => {
    const result = aggregateMonth({
      transactions: all,
      monthKey: '2026-08',
      scope: { kind: 'own' },
      basis: 'burden',
      selfId: taro,
      members,
    });
    expect(result.expense).toBe(780);
  });

  it('列6 同じ名前でも共有範囲が違えば別の行になる', () => {
    const result = aggregateMonth({
      transactions: all,
      monthKey: '2026-08',
      scope: { kind: 'all' },
      basis: 'burden',
      selfId: taro,
      members,
    });
    const food = result.byCategory.filter((r) => r.name === '食費');
    expect(food).toHaveLength(2);
    expect(food.map((r) => r.scopeLabel).sort()).toEqual(['individual', 'group'].sort());
  });

  it('列6 カテゴリ別は金額の降順に並ぶ', () => {
    const result = aggregateMonth({
      transactions: all,
      monthKey: '2026-08',
      scope: { kind: 'group', shareGroupId: 夫婦 },
      basis: 'burden',
      selfId: taro,
      members,
    });
    expect(result.byCategory.map((r) => r.amount)).toEqual([120000, 4200]);
  });

  it('列7 脱退した人も、その範囲のデータに現れるなら並べる', () => {
    const result = aggregateMonth({
      transactions: all,
      monthKey: '2026-08',
      scope: { kind: 'group', shareGroupId: 夫婦 },
      basis: 'burden',
      selfId: taro,
      // はなこ はもうメンバーではないが、負担者として残っている
      members: { [夫婦]: [taro] },
    });
    expect(result.byUser.map((r) => r.userId)).toContain(hana);
  });

  it('列8 対象月の取引だけを数える', () => {
    const result = aggregateMonth({
      transactions: all,
      monthKey: '2026-07',
      scope: { kind: 'group', shareGroupId: 夫婦 },
      basis: 'burden',
      selfId: taro,
      members,
    });
    expect(result.expense).toBe(100000);
  });

  it('列10 取引が無い月でも0として返す', () => {
    const result = aggregateMonth({
      transactions: all,
      monthKey: '2026-06',
      scope: { kind: 'all' },
      basis: 'burden',
      selfId: taro,
      members,
    });
    expect(result).toMatchObject({ income: 0, expense: 0, balance: 0 });
    expect(result.byCategory).toEqual([]);
  });
});

describe('monthDiff', () => {
  it('列9 前月比は当月の支出合計から前月を引いた値', () => {
    const scope = { kind: 'group', shareGroupId: 夫婦 } as const;
    const common = { transactions: all, scope, basis: 'burden' as const, selfId: taro, members };
    const current = aggregateMonth({ ...common, monthKey: '2026-08' });
    const previous = aggregateMonth({ ...common, monthKey: '2026-07' });
    expect(monthDiff(current, previous)).toBe(124200 - 100000);
  });
});

describe('categorySlices', () => {
  const category = (id: string, amount: number): CategoryTotal => ({
    categoryId: id,
    name: id,
    scopeLabel: 'individual',
    shareGroupId: null,
    children: [],
    amount,
  });

  it('割合と色の番号を付けて返す', () => {
    const slices = categorySlices([category('a', 3000), category('b', 1000)]);
    expect(slices).toEqual([
      { key: 'a', name: 'a', amount: 3000, ratio: 0.75, colorIndex: 1 },
      { key: 'b', name: 'b', amount: 1000, ratio: 0.25, colorIndex: 2 },
    ]);
  });

  it('色数を超えた分は「その他」にまとめる', () => {
    const rows = Array.from({ length: PIE_COLORS + 3 }, (_, i) => category(`c${i}`, 100));
    const slices = categorySlices(rows);
    expect(slices).toHaveLength(PIE_COLORS);
    expect(slices.at(-1)).toMatchObject({ key: 'other', name: 'その他', amount: 400 });
  });

  it('取引が無い月は空で返す', () => {
    expect(categorySlices([])).toEqual([]);
  });
});

describe('aggregateMonth（小分類）', () => {
  /** 夫婦の食費 / 外食 3,000。親は c-food-shared */
  const 外食: AggregateTx = {
    id: 't4',
    occurredOn: '2026-08-31',
    categoryId: 'c-eat',
    categoryName: '外食',
    parentId: 'c-food-shared',
    parentName: '食費',
    kind: 'expense',
    shareGroupId: 夫婦,
    ownerId: null,
    amount: 3000,
    payerId: hana,
    splits: [
      { userId: taro, amount: 1500 },
      { userId: hana, amount: 1500 },
    ],
  };

  const run = () =>
    aggregateMonth({
      transactions: [rent, food, 外食],
      monthKey: '2026-08',
      scope: { kind: 'group', shareGroupId: 夫婦 },
      basis: 'burden',
      selfId: taro,
      members,
    });

  it('列12 カテゴリ別の内訳は大分類で集約し、配下の小分類を含む', () => {
    const rows = run().byCategory;
    expect(rows.map((r) => r.name)).toEqual(['家賃', '食費']);
    const 食費 = rows.find((r) => r.name === '食費')!;
    expect(食費.categoryId).toBe('c-food-shared');
    expect(食費.amount).toBe(4200 + 3000);
  });

  it('列13 展開すると小分類の内訳が出る。大分類に直接付いた分は（小分類なし）', () => {
    const 食費 = run().byCategory.find((r) => r.name === '食費')!;
    expect(食費.children).toEqual([
      { categoryId: 'c-food-shared', name: NO_SUBCATEGORY, amount: 4200 },
      { categoryId: 'c-eat', name: '外食', amount: 3000 },
    ]);
    expect(食費.children.reduce((sum, c) => sum + c.amount, 0)).toBe(食費.amount);
  });

  it('列13 小分類の取引が無い大分類は内訳を持たない', () => {
    const 家賃 = run().byCategory.find((r) => r.name === '家賃')!;
    expect(家賃.children).toEqual([]);
  });

  it('列12 円グラフは大分類の単位で描く', () => {
    const slices = categorySlices(run().byCategory);
    expect(slices.map((s) => s.name)).toEqual(['家賃', '食費']);
    expect(slices.find((s) => s.name === '食費')!.amount).toBe(7200);
  });
});
