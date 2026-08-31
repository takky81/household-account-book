import { describe, it, expect } from 'vitest';
import { budgetCsv, categoryCsv, groupCsv, transactionCsv } from './export';
import { parseCsvRows } from '../../lib/csv';

const names = { u1: 'たかし', u2: 'はなこ' };
const groups = { g1: '夫婦' };

const tx = {
  occurredOn: '2026-08-31',
  kind: 'expense' as const,
  shareGroupId: 'g1' as string | null,
  ownerId: null as string | null,
  categoryName: '家賃',
  amount: 120000,
  payerId: null as string | null,
  splits: [
    { userId: 'u1', amount: 60000 },
    { userId: 'u2', amount: 60000 },
  ],
  memo: '8月分',
};

describe('transactionCsv', () => {
  it('列1 負担を常に明示して書き出す', () => {
    const { rows } = parseCsvRows(transactionCsv([tx], names, groups));
    expect(rows[0]).toMatchObject({
      日付: '2026-08-31',
      収支: '支出',
      共有範囲: '夫婦',
      カテゴリ: '家賃',
      金額: '120000',
      負担: 'たかし:60000;はなこ:60000',
      備考: '8月分',
    });
  });

  it('列3 支払者なしは共用と書く', () => {
    const { rows } = parseCsvRows(transactionCsv([tx], names, groups));
    expect(rows[0]!.支払者).toBe('共用');
  });

  it('個人カテゴリの共有範囲は個人と書く', () => {
    const own = { ...tx, shareGroupId: null, ownerId: 'u1', payerId: 'u1', splits: [{ userId: 'u1', amount: 780 }] };
    const { rows } = parseCsvRows(transactionCsv([own], names, groups));
    expect(rows[0]!.共有範囲).toBe('個人');
    expect(rows[0]!.支払者).toBe('たかし');
  });

  it('列1 金額に桁区切りや通貨記号を付けない', () => {
    expect(transactionCsv([tx], names, groups)).toContain('120000');
    expect(transactionCsv([tx], names, groups)).not.toContain('120,000');
  });
});

describe('categoryCsv', () => {
  it('列6 共有範囲つきで、未分類とアーカイブ済みを はい／いいえ で出す', () => {
    const { rows } = parseCsvRows(
      categoryCsv(
        [
          {
            id: 'c1',
            shareGroupId: 'g1',
            ownerId: null,
            kind: 'expense',
            name: '家賃',
            color: '#e11d48',
            sortOrder: 10,
            isSystem: false,
            isArchived: false,
          },
          {
            id: 'c2',
            shareGroupId: null,
            ownerId: 'u1',
            kind: 'income',
            name: '未分類',
            color: '#64748b',
            sortOrder: 9999,
            isSystem: true,
            isArchived: false,
          },
        ],
        groups,
      ),
    );
    expect(rows[0]).toMatchObject({ 共有範囲: '夫婦', 収支: '支出', カテゴリ: '家賃', 未分類: 'いいえ' });
    expect(rows[1]).toMatchObject({ 共有範囲: '個人', 収支: '収入', 未分類: 'はい' });
  });
});

describe('budgetCsv', () => {
  it('列7 対象月は YYYY-MM で書く', () => {
    const { rows } = parseCsvRows(
      budgetCsv(
        [{ categoryId: 'c1', month: '2026-08-01', amount: 120000 }],
        [
          {
            id: 'c1',
            shareGroupId: 'g1',
            ownerId: null,
            kind: 'expense',
            name: '家賃',
            isArchived: false,
          },
        ],
        groups,
      ),
    );
    expect(rows[0]).toMatchObject({ 共有範囲: '夫婦', カテゴリ: '家賃', 対象月: '2026-08', 予算額: '120000' });
  });
});

describe('groupCsv', () => {
  it('列8 メンバー1人を1行として出す', () => {
    const { rows } = parseCsvRows(
      groupCsv(
        [{ id: 'g1', name: '夫婦' }],
        {
          g1: [
            { userId: 'u1', defaultWeight: 1, sortOrder: 10 },
            { userId: 'u2', defaultWeight: 3, sortOrder: 20 },
          ],
        },
        names,
      ),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ グループ: '夫婦', メンバー: 'たかし', 負担割合: '1', 表示順: '10' });
    expect(rows[1]).toMatchObject({ メンバー: 'はなこ', 負担割合: '3' });
  });
});
