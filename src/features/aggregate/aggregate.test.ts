import { describe, it, expect } from 'vitest';
import { SHARED_PAYER, aggregateMonth, targetUsers, type AggregateTx } from './aggregate';

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
