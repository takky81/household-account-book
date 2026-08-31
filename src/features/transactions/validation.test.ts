import { describe, it, expect } from 'vitest';
import { validateTransaction } from './validation';

const base = {
  amount: 4200,
  isPersonal: false,
  ownerId: null as string | null,
  payerId: 'u1' as string | null,
  memberIds: ['u1', 'u2'],
  splits: [
    { userId: 'u1', amount: 2100 },
    { userId: 'u2', amount: 2100 },
  ],
};

describe('validateTransaction', () => {
  it('整っていれば保存できる', () => {
    expect(validateTransaction(base)).toEqual({ ok: true });
  });

  it('列6 金額が0以下なら保存できない', () => {
    expect(validateTransaction({ ...base, amount: 0, splits: [] }).ok).toBe(false);
    expect(validateTransaction({ ...base, amount: -1, splits: [] }).ok).toBe(false);
  });

  it('列8 負担の合計が金額と一致しないと保存できない', () => {
    const result = validateTransaction({
      ...base,
      splits: [
        { userId: 'u1', amount: 3000 },
        { userId: 'u2', amount: 1000 },
      ],
    });
    expect(result).toEqual({ ok: false, message: '負担の合計 4,000 が金額 4,200 と一致しません' });
  });

  it('列9 同じ人が負担に2回現れると保存できない', () => {
    const result = validateTransaction({
      ...base,
      splits: [
        { userId: 'u1', amount: 2100 },
        { userId: 'u1', amount: 2100 },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('列10 負の負担額は合計が合っていても保存できない', () => {
    const result = validateTransaction({
      ...base,
      splits: [
        { userId: 'u1', amount: -100 },
        { userId: 'u2', amount: 4300 },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('列4 個人カテゴリの支払者を共用にできない', () => {
    const result = validateTransaction({
      ...base,
      isPersonal: true,
      ownerId: 'u1',
      payerId: null,
      splits: [{ userId: 'u1', amount: 4200 }],
    });
    expect(result.ok).toBe(false);
  });

  it('列5 共有範囲のメンバーでない人は支払者にできない', () => {
    expect(validateTransaction({ ...base, payerId: 'u9' }).ok).toBe(false);
  });

  it('個人カテゴリの負担は本人だけ', () => {
    const result = validateTransaction({
      ...base,
      isPersonal: true,
      ownerId: 'u1',
      payerId: 'u1',
      splits: [
        { userId: 'u1', amount: 2100 },
        { userId: 'u2', amount: 2100 },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('列14 残りを自動で埋めた負担はそのまま保存できる', () => {
    const result = validateTransaction({
      ...base,
      splits: [
        { userId: 'u1', amount: 400 },
        { userId: 'u2', amount: 3800 },
      ],
    });
    expect(result).toEqual({ ok: true });
  });

  it('列2 共用払いは共有カテゴリなら通る', () => {
    expect(validateTransaction({ ...base, payerId: null })).toEqual({ ok: true });
  });
});

describe('編集のとき', () => {
  it('列11 支払者が変わっていなければ、脱退した人が支払者のままでも保存できる', () => {
    const result = validateTransaction({
      ...base,
      // u2 はもうメンバーではない。負担は今のメンバーだけで引き直されている
      memberIds: ['u1'],
      payerId: 'u2',
      splits: [{ userId: 'u1', amount: 4200 }],
      payerUnchanged: true,
    });
    expect(result).toEqual({ ok: true });
  });

  it('列5 支払者を変えるときは、変えた先のメンバーかどうかを見る', () => {
    const result = validateTransaction({
      ...base,
      memberIds: ['u1'],
      payerId: 'u2',
      splits: [{ userId: 'u1', amount: 4200 }],
      payerUnchanged: false,
    });
    expect(result.ok).toBe(false);
  });

  it('支払者が変わっていなくても、負担の相手は今のメンバーでなければならない', () => {
    const result = validateTransaction({
      ...base,
      memberIds: ['u1'],
      payerId: 'u2',
      splits: [
        { userId: 'u1', amount: 2100 },
        { userId: 'u2', amount: 2100 },
      ],
      payerUnchanged: true,
    });
    expect(result.ok).toBe(false);
  });
});
