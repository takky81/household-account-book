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
    { id: 'c1', parentId: null, kind: 'expense', name: '家賃', isArchived: false },
    { id: 'c2', parentId: null, kind: 'expense', name: '未分類', isArchived: false, isSystem: true },
    { id: 'c3', parentId: null, kind: 'expense', name: '食費', isArchived: false },
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
          shareGroupId: 'g1',
          ownerId: null,
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
          shareGroupId: 'g1',
          ownerId: null,
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
      kind: 'expense',
      name: '日用品',
      parentId: null,
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

describe('analyzeImport（小分類）', () => {
  const withSub = '日付,収支,共有範囲,カテゴリ,小分類,金額,支払者,負担,備考';
  const 外食 = { id: 'c5', parentId: 'c3', kind: 'expense' as const, name: '外食', isArchived: false };
  const subContext = (over: Partial<ImportContext> = {}) => {
    const base = context(over);
    return { ...base, categories: [...base.categories, 外食] };
  };
  const runSub = (lines: string[], over: Partial<ImportContext> = {}) =>
    analyzeImport([withSub, ...lines].join('\r\n') + '\r\n', subContext(over));

  it('列17 小分類つきの行はその小分類に付く', () => {
    const result = runSub(['2026-08-31,支出,個人,食費,外食,780,たかし,,昼食']);
    expect(result.counts).toMatchObject({ ok: 1, error: 0 });
    expect(result.entries[0]).toMatchObject({ status: 'ok', payload: { categoryId: 'c5' } });
  });

  it('列17 小分類が空欄なら大分類そのものに付く', () => {
    const result = runSub(['2026-08-31,支出,個人,食費,,780,たかし,,昼食']);
    expect(result.entries[0]).toMatchObject({ status: 'ok', payload: { categoryId: 'c3' } });
  });

  it('列18 小分類の列が無いファイルもそのまま取り込める', () => {
    const result = analyzeImport(
      [header, '2026-08-31,支出,個人,食費,780,たかし,,昼食'].join('\r\n') + '\r\n',
      subContext(),
    );
    expect(result.counts).toMatchObject({ ok: 1, error: 0 });
    expect(result.entries[0]).toMatchObject({ status: 'ok', payload: { categoryId: 'c3' } });
  });

  it('列19 未知の小分類は既存の大分類の下に作る', () => {
    const result = runSub(['2026-08-31,支出,個人,食費,自炊,780,たかし,,'], {
      unknownCategory: 'create',
    });
    expect(result.entries[0]).toMatchObject({
      status: 'ok',
      payload: {
        categoryId: null,
        newCategory: { parentId: 'c3', name: '自炊', kind: 'expense' },
      },
    });
  });

  it('列19 大分類ごと未知なら、まず大分類を作る', () => {
    const result = runSub(['2026-08-31,支出,個人,交際費,飲み会,780,たかし,,'], {
      unknownCategory: 'create',
    });
    expect(result.entries[0]).toMatchObject({
      status: 'ok',
      payload: { newCategory: { parentId: null, name: '交際費' } },
    });
  });

  it('列19 未分類にする選択なら小分類は捨てて未分類へ付ける', () => {
    const result = runSub(['2026-08-31,支出,個人,交際費,飲み会,780,たかし,,'], {
      unknownCategory: 'uncategorized',
    });
    expect(result.entries[0]).toMatchObject({
      status: 'ok',
      payload: { categoryId: 'c2', newCategory: null },
    });
  });

  it('列21 共有範囲が違えば重複にしない', () => {
    // カテゴリは全ユーザー共通なので、カテゴリだけで比べると夫婦の1件と
    // 個人の1件が同じ取引に見えてしまう
    const existing = [
      {
        occurredOn: '2026-08-31',
        categoryId: 'c3',
        shareGroupId: null,
        ownerId: 'u1',
        amount: 780,
        payerId: 'u1',
        memo: '昼食',
        splits: [{ userId: 'u1', amount: 780 }],
      },
    ];
    const 同じ範囲 = run(['2026-08-31,支出,個人,食費,780,たかし,,昼食'], { existing });
    expect(同じ範囲.counts).toMatchObject({ ok: 0, skipped: 1 });

    const 違う範囲 = run(['2026-08-31,支出,夫婦,食費,780,たかし,たかし:780,昼食'], { existing });
    expect(違う範囲.counts).toMatchObject({ ok: 1, skipped: 0 });
  });

  it('列20 小分類が違えば重複にしない', () => {
    const existing = [
      {
        occurredOn: '2026-08-31',
        categoryId: 'c3',
        shareGroupId: null,
        ownerId: 'u1',
        amount: 780,
        payerId: 'u1',
        memo: '昼食',
        splits: [{ userId: 'u1', amount: 780 }],
      },
    ];
    const 同じ = runSub(['2026-08-31,支出,個人,食費,,780,たかし,,昼食'], { existing });
    expect(同じ.counts).toMatchObject({ ok: 0, skipped: 1 });

    const 小分類つき = runSub(['2026-08-31,支出,個人,食費,外食,780,たかし,,昼食'], { existing });
    expect(小分類つき.counts).toMatchObject({ ok: 1, skipped: 0 });
  });
});
