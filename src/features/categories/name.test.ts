import { describe, it, expect } from 'vitest';
import { findNameConflict, normalizeCategoryName, scopeKey, validateCategoryName } from './name';

const cat = (over: Partial<Parameters<typeof findNameConflict>[0][number]>) => ({
  id: 'c1',
  parentId: null as string | null,
  kind: 'expense' as const,
  name: '食費',
  isArchived: false,
  ...over,
});

describe('カテゴリ名', () => {
  it('列6 前後の空白は落とす', () => {
    expect(normalizeCategoryName(' 食費 ')).toBe('食費');
  });

  it('列6 空白だけの名前は使えない', () => {
    expect(validateCategoryName('   ').ok).toBe(false);
    expect(validateCategoryName('食費')).toEqual({ ok: true });
  });
});

describe('findNameConflict', () => {
  const existing = [cat({})];

  it('列3 同じ収支区分に同名があれば衝突', () => {
    const found = findNameConflict(existing, { kind: 'expense', name: '食費' });
    expect(found?.id).toBe('c1');
  });

  it('列4 カテゴリは全ユーザー共通なので、共有範囲では逃げられない', () => {
    // 以前は『夫婦 / 食費』と『個人 / 食費』を並べられたが、共通マスタでは1つに決まる
    const found = findNameConflict(existing, { kind: 'expense', name: '食費' });
    expect(found?.id).toBe('c1');
  });

  it('収支区分が違えば衝突しない', () => {
    const found = findNameConflict(existing, { kind: 'income', name: '食費' });
    expect(found).toBeNull();
  });

  it('列5 アーカイブ済みも衝突として数える', () => {
    const found = findNameConflict([cat({ isArchived: true })], {
      kind: 'expense',
      name: '食費',
    });
    expect(found?.id).toBe('c1');
  });

  it('列3 前後の空白は落としてから比べる', () => {
    const found = findNameConflict(existing, { kind: 'expense', name: ' 食費 ' });
    expect(found?.id).toBe('c1');
  });

  it('自分自身とは衝突しない（編集のとき）', () => {
    const found = findNameConflict(existing, { kind: 'expense', name: '食費' }, 'c1');
    expect(found).toBeNull();
  });
});

describe('findNameConflict（小分類）', () => {
  const 食費 = cat({ id: 'c-food', name: '食費' });
  const 外食 = cat({ id: 'c-eat', name: '外食', parentId: 'c-food' });

  it('列16 同じ親に同じ名前の小分類があれば衝突', () => {
    const found = findNameConflict([食費, 外食], {
      kind: 'expense',
      name: '外食',
      parentId: 'c-food',
    });
    expect(found?.id).toBe('c-eat');
  });

  it('列17 親が違えば同じ名前でも衝突しない', () => {
    const found = findNameConflict([食費, 外食], {
      kind: 'expense',
      name: '外食',
      parentId: 'c-other',
    });
    expect(found).toBeNull();
  });

  it('大分類と小分類は名前が同じでも衝突しない', () => {
    const found = findNameConflict([外食], { kind: 'expense', name: '外食', parentId: null });
    expect(found).toBeNull();
  });

  it('小分類は大分類とは衝突しない', () => {
    const found = findNameConflict([食費], {
      kind: 'expense',
      name: '食費',
      parentId: 'c-daily',
    });
    expect(found).toBeNull();
  });
});

describe('scopeKey', () => {
  it('共有範囲を1つの文字列で表す', () => {
    expect(scopeKey('g1', null)).toBe('group:g1');
    expect(scopeKey(null, 'u1')).toBe('own:u1');
  });
});
