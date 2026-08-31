import { describe, it, expect } from 'vitest';
import { analyzeImport, type ImportContext } from './import';

const header = '日付,収支,共有範囲,カテゴリ,金額,支払者,負担,備考';

const context = (over: Partial<ImportContext> = {}): ImportContext => ({
  selfId: 'u1',
  profiles: [
    { id: 'u1', displayName: 'たかし' },
    { id: 'u2', displayName: 'はなこ' },
    { id: 'u3', displayName: 'よその人' },
  ],
  groups: [{ id: 'g1', name: '夫婦' }],
  members: {
    g1: [
      { userId: 'u1', defaultWeight: 1, sortOrder: 10 },
      { userId: 'u2', defaultWeight: 1, sortOrder: 20 },
    ],
  },
  categories: [
    { id: 'c1', shareGroupId: 'g1', ownerId: null, kind: 'expense', name: '家賃', isArchived: false },
    { id: 'c2', shareGroupId: 'g1', ownerId: null, kind: 'expense', name: '未分類', isArchived: false, isSystem: true },
    { id: 'c3', shareGroupId: null, ownerId: 'u1', kind: 'expense', name: '食費', isArchived: false },
    { id: 'c4', shareGroupId: null, ownerId: 'u1', kind: 'expense', name: '未分類', isArchived: false, isSystem: true },
  ],
  existing: [],
  unknownCategory: 'uncategorized',
  duplicates: 'skip',
  ...over,
});

const run = (lines: string[], over: Partial<ImportContext> = {}) =>
  analyzeImport([header, ...lines].join('\r\n') + '\r\n', context(over));

describe('analyzeImport', () => {
  it('列1 すべての列が正しければ取り込む', () => {
    const result = run(['2026-08-31,支出,夫婦,家賃,120000,共用,たかし:60000;はなこ:60000,8月分']);
    expect(result.counts).toMatchObject({ ok: 1, skipped: 0, error: 0 });
    expect(result.entries[0]).toMatchObject({
      status: 'ok',
      payload: {
        categoryId: 'c1',
        occurredOn: '2026-08-31',
        amount: 120000,
        payerId: null,
        memo: '8月分',
      },
    });
  });

  it('列2 負担が空欄なら既定割合で按分する', () => {
    const result = run(['2026-08-31,支出,夫婦,家賃,1001,たかし,,']);
    expect(result.entries[0]).toMatchObject({ status: 'ok' });
    const entry = result.entries[0]!;
    expect(entry.status === 'ok' && entry.payload.splits).toEqual([
      { userId: 'u1', amount: 501 },
      { userId: 'u2', amount: 500 },
    ]);
  });

  it('列2 個人カテゴリで負担が空欄なら本人が全額', () => {
    const result = run(['2026-08-31,支出,個人,食費,780,たかし,,昼食']);
    const entry = result.entries[0]!;
    expect(entry.status === 'ok' && entry.payload.splits).toEqual([{ userId: 'u1', amount: 780 }]);
  });

  it('列4 既にある取引と同じ内容なら重複として飛ばす（按分後の負担で比べる）', () => {
    const result = run(['2026-08-31,支出,夫婦,家賃,1001,たかし,,'], {
      existing: [
        {
          occurredOn: '2026-08-31',
          categoryId: 'c1',
          amount: 1001,
          payerId: 'u1',
          memo: '',
          splits: [
            { userId: 'u1', amount: 501 },
            { userId: 'u2', amount: 500 },
          ],
        },
      ],
    });
    expect(result.counts).toMatchObject({ ok: 0, skipped: 1 });
    expect(result.entries[0]).toMatchObject({ status: 'skip' });
  });

  it('列4 重複でも取り込むを選べば取り込む', () => {
    const result = run(['2026-08-31,支出,夫婦,家賃,1001,たかし,,'], {
      duplicates: 'import',
      existing: [
        {
          occurredOn: '2026-08-31',
          categoryId: 'c1',
          amount: 1001,
          payerId: 'u1',
          memo: '',
          splits: [
            { userId: 'u1', amount: 501 },
            { userId: 'u2', amount: 500 },
          ],
        },
      ],
    });
    expect(result.counts).toMatchObject({ ok: 1, skipped: 0 });
  });

  it('列5 日付の書式が不正な行はエラーにする', () => {
    const result = run(['2026/08/29,支出,夫婦,家賃,1000,たかし,,']);
    expect(result.entries[0]).toMatchObject({ status: 'error' });
    expect(result.counts.error).toBe(1);
  });

  it('列6 金額が1未満または整数でない行はエラーにする', () => {
    const result = run([
      '2026-08-31,支出,夫婦,家賃,0,たかし,,',
      '2026-08-31,支出,夫婦,家賃,1.5,たかし,,',
    ]);
    expect(result.counts.error).toBe(2);
  });

  it('列7 未知のカテゴリを未分類にできる', () => {
    const result = run(['2026-08-31,支出,夫婦,日用品,1000,たかし,,']);
    const entry = result.entries[0]!;
    expect(entry.status === 'ok' && entry.payload.categoryId).toBe('c2');
  });

  it('列8 未知のカテゴリをその共有範囲に作れる', () => {
    const result = run(['2026-08-31,支出,夫婦,日用品,1000,たかし,,'], {
      unknownCategory: 'create',
    });
    const entry = result.entries[0]!;
    expect(entry.status === 'ok' && entry.payload.newCategory).toEqual({
      shareGroupId: 'g1',
      ownerId: null,
      kind: 'expense',
      name: '日用品',
    });
  });

  it('列9 未知のグループはエラーにする（自動で作らない）', () => {
    const result = run(['2026-08-31,支出,単身赴任,家賃,1000,たかし,,']);
    expect(result.entries[0]).toMatchObject({ status: 'error' });
  });

  it('列10 共有範囲のメンバーでない人が支払者ならエラーにする', () => {
    const result = run(['2026-08-31,支出,夫婦,家賃,1000,よその人,,']);
    expect(result.entries[0]).toMatchObject({ status: 'error' });
  });

  it('列11 共有範囲が個人なのに支払者が共用ならエラーにする', () => {
    const result = run(['2026-08-31,支出,個人,食費,780,共用,,']);
    expect(result.entries[0]).toMatchObject({ status: 'error' });
  });

  it('列12 共有範囲が個人なのに他人の負担があればエラーにする', () => {
    const result = run(['2026-08-31,支出,個人,食費,780,たかし,はなこ:780,']);
    expect(result.entries[0]).toMatchObject({ status: 'error' });
  });

  it('列13 負担の合計が金額と一致しない行はエラーにする', () => {
    const result = run(['2026-08-31,支出,夫婦,家賃,3000,たかし,たかし:2000;はなこ:500,']);
    expect(result.entries[0]).toMatchObject({ status: 'error' });
  });

  it('列14 負担に同じ人が2回現れる行はエラーにする', () => {
    const result = run(['2026-08-31,支出,夫婦,家賃,3000,たかし,たかし:2000;たかし:1000,']);
    expect(result.entries[0]).toMatchObject({ status: 'error' });
  });

  it('列15 負担額に0未満があれば、合計が合っていてもエラーにする', () => {
    const result = run(['2026-08-31,支出,夫婦,家賃,1000,たかし,たかし:-100;はなこ:1100,']);
    expect(result.entries[0]).toMatchObject({ status: 'error' });
  });

  it('列16 正しい行とエラー行が混ざっていても、正しい行は取り込む', () => {
    const result = run([
      '2026-08-31,支出,夫婦,家賃,120000,共用,,',
      '2026/08/29,支出,夫婦,家賃,1000,たかし,,',
      '2026-08-28,支出,個人,食費,780,たかし,,昼食',
    ]);
    expect(result.counts).toMatchObject({ ok: 2, error: 1 });
    expect(result.entries.map((e) => e.line)).toEqual([2, 3, 4]);
  });

  it('列3 列の並び順が違っても読む', () => {
    const text = ['金額,日付,共有範囲,カテゴリ,収支,支払者,負担,備考', '1000,2026-08-31,夫婦,家賃,支出,たかし,,'].join(
      '\r\n',
    );
    const result = analyzeImport(text, context());
    expect(result.counts.ok).toBe(1);
  });
});
