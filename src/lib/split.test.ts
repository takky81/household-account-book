import { describe, it, expect } from 'vitest';
import { defaultSplits, fillRemainder, isBalanced, splitByWeight } from './split';

const taro = { userId: 'a-taro', weight: 1, sortOrder: 10 };
const hana = { userId: 'b-hana', weight: 1, sortOrder: 20 };

const shared = (over: Partial<Parameters<typeof defaultSplits>[0]> = {}) =>
  defaultSplits({
    members: [taro, hana],
    amount: 1000,
    kind: 'expense',
    payerId: taro.userId,
    ownerId: null,
    ...over,
  });

describe('splitAmount', () => {
  it('列1 1001円の折半は501と500になる', () => {
    const splits = shared({ amount: 1001 });
    expect(splits).toEqual([
      { userId: 'a-taro', amount: 501 },
      { userId: 'b-hana', amount: 500 },
    ]);
    expect(isBalanced(splits, 1001)).toBe(true);
  });

  it('列2 7:3 の重みで割り付ける', () => {
    const splits = shared({
      members: [
        { ...taro, weight: 7 },
        { ...hana, weight: 3 },
      ],
      amount: 1000,
    });
    expect(splits).toEqual([
      { userId: 'a-taro', amount: 700 },
      { userId: 'b-hana', amount: 300 },
    ]);
  });

  it('列3 重み0のメンバーを外す', () => {
    const splits = shared({ members: [taro, { ...hana, weight: 0 }], amount: 1000 });
    expect(splits).toEqual([{ userId: 'a-taro', amount: 1000 }]);
  });

  it('列4 重みの合計が0なら支払者が全額', () => {
    const splits = shared({
      members: [
        { ...taro, weight: 0 },
        { ...hana, weight: 0 },
      ],
      payerId: hana.userId,
    });
    expect(splits).toEqual([{ userId: 'b-hana', amount: 1000 }]);
  });

  it('列5 W=0 かつ共用なら全員で均等に割る', () => {
    const splits = shared({
      members: [
        { ...taro, weight: 0 },
        { ...hana, weight: 0 },
      ],
      payerId: null,
      amount: 1001,
    });
    expect(splits).toEqual([
      { userId: 'a-taro', amount: 501 },
      { userId: 'b-hana', amount: 500 },
    ]);
  });

  it('列6 個人カテゴリは本人が全額', () => {
    const splits = defaultSplits({
      members: [],
      amount: 780,
      kind: 'expense',
      payerId: 'a-taro',
      ownerId: 'a-taro',
    });
    expect(splits).toEqual([{ userId: 'a-taro', amount: 780 }]);
  });

  it('列7 収入は受け取った本人が全額', () => {
    const splits = shared({ kind: 'income', payerId: hana.userId, amount: 3000 });
    expect(splits).toEqual([{ userId: 'b-hana', amount: 3000 }]);
  });

  it('列8 共用の収入は重みで按分する', () => {
    const splits = shared({ kind: 'income', payerId: null, amount: 3000 });
    expect(splits).toEqual([
      { userId: 'a-taro', amount: 1500 },
      { userId: 'b-hana', amount: 1500 },
    ]);
  });

  it('列9 タイブレークは sort_order 昇順', () => {
    const splits = splitByWeight(
      [
        { userId: 'z-late', weight: 1, sortOrder: 99 },
        { userId: 'a-early', weight: 1, sortOrder: 1 },
      ],
      1001,
    );
    expect(splits[0]).toEqual({ userId: 'a-early', amount: 501 });
    expect(splits[1]).toEqual({ userId: 'z-late', amount: 500 });
  });

  it('列10 手入力があれば按分しない（合計の検査だけを行う）', () => {
    expect(isBalanced([{ userId: 'a-taro', amount: 999 }], 1000)).toBe(false);
    expect(
      isBalanced(
        [
          { userId: 'a-taro', amount: 700 },
          { userId: 'b-hana', amount: 300 },
        ],
        1000,
      ),
    ).toBe(true);
  });
});

describe('fillRemainder', () => {
  it('列14 残額を他のメンバーに割り付ける', () => {
    const splits = fillRemainder([taro, hana], 1000, [{ userId: 'a-taro', amount: 400 }]);
    expect(splits).toEqual([
      { userId: 'a-taro', amount: 400 },
      { userId: 'b-hana', amount: 600 },
    ]);
    expect(isBalanced(splits, 1000)).toBe(true);
  });
});
