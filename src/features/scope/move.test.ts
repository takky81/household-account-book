import { describe, it, expect } from 'vitest';
import { checkMove, manualCount, scopeChanged, type MoveTx } from './move';

const taro = 'u1';
const hana = 'u2';
const 夫婦 = 'g1';

const tx = (over: Partial<MoveTx> = {}): MoveTx => ({
  id: 't1',
  payerId: taro,
  splitUserIds: [taro],
  splitsAreManual: false,
  amount: 1000,
  ...over,
});

describe('scopeChanged', () => {
  it('列10 同じ共有範囲なら変わっていない', () => {
    expect(scopeChanged({ shareGroupId: 夫婦, ownerId: null }, { shareGroupId: 夫婦, ownerId: null })).toBe(
      false,
    );
  });

  it('列1 個人からグループへは変わったとみなす', () => {
    expect(scopeChanged({ shareGroupId: null, ownerId: taro }, { shareGroupId: 夫婦, ownerId: null })).toBe(
      true,
    );
  });
});

describe('checkMove', () => {
  const base = {
    source: { shareGroupId: null, ownerId: taro },
    dest: { shareGroupId: 夫婦, ownerId: null },
    transactions: [tx()],
    destMemberIds: [taro, hana],
    selfId: taro,
    myGroupIds: [夫婦],
  };

  it('列1 条件が揃えば移せる', () => {
    expect(checkMove(base)).toEqual({ ok: true });
  });

  // 列2（移動先に同名のカテゴリがあれば中止）はもう無い。カテゴリは共有範囲を持たず、
  // 動かすのは取引だけなので、名前が衝突しようがない

  it('列4 移動先が個人なら、他人が支払った取引があると中止する', () => {
    const result = checkMove({
      ...base,
      source: { shareGroupId: 夫婦, ownerId: null },
      dest: { shareGroupId: null, ownerId: taro },
      destMemberIds: [taro],
      transactions: [tx({ payerId: hana, splitUserIds: [hana] })],
    });
    expect(result).toMatchObject({ ok: false, reason: 'others-involved', count: 1 });
  });

  it('列4 移動先が個人なら、共用払いも中止の対象にする', () => {
    const result = checkMove({
      ...base,
      source: { shareGroupId: 夫婦, ownerId: null },
      dest: { shareGroupId: null, ownerId: taro },
      destMemberIds: [taro],
      transactions: [tx({ payerId: null })],
    });
    expect(result).toMatchObject({ ok: false, reason: 'others-involved' });
  });

  it('列5 自分だけの取引ならグループから個人へ移せる', () => {
    const result = checkMove({
      ...base,
      source: { shareGroupId: 夫婦, ownerId: null },
      dest: { shareGroupId: null, ownerId: taro },
      destMemberIds: [taro],
      transactions: [tx()],
    });
    expect(result).toEqual({ ok: true });
  });

  it('列6 移動先グループの非メンバーが支払った取引があると中止する', () => {
    const result = checkMove({
      ...base,
      destMemberIds: [taro],
      transactions: [tx({ payerId: hana })],
    });
    expect(result).toMatchObject({ ok: false, reason: 'non-member-payer', count: 1 });
  });

  it('列7 共用払いは共有から共有への移動では通す', () => {
    const result = checkMove({
      ...base,
      source: { shareGroupId: 'g2', ownerId: null },
      transactions: [tx({ payerId: null })],
    });
    expect(result).toEqual({ ok: true });
  });

  it('列9 自分が属さないグループへは移せない', () => {
    const result = checkMove({ ...base, myGroupIds: [] });
    expect(result).toMatchObject({ ok: false, reason: 'not-member' });
  });
});

describe('manualCount', () => {
  it('列11 手で直した負担の件数を数える', () => {
    expect(manualCount([tx(), tx({ id: 't2', splitsAreManual: true })])).toBe(1);
  });
});
