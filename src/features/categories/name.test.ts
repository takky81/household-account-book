import { describe, it, expect } from 'vitest';
import { findNameConflict, normalizeCategoryName, scopeKey, validateCategoryName } from './name';

const cat = (over: Partial<Parameters<typeof findNameConflict>[0][number]>) => ({
  id: 'c1',
  shareGroupId: 'g1' as string | null,
  ownerId: null as string | null,
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

  it('列3 同じ共有範囲・同じ収支区分に同名があれば衝突', () => {
    const found = findNameConflict(existing, {
      shareGroupId: 'g1',
      ownerId: null,
      kind: 'expense',
      name: '食費',
    });
    expect(found?.id).toBe('c1');
  });

  it('列4 共有範囲が違えば衝突しない', () => {
    const found = findNameConflict(existing, {
      shareGroupId: null,
      ownerId: 'u1',
      kind: 'expense',
      name: '食費',
    });
    expect(found).toBeNull();
  });

  it('収支区分が違えば衝突しない', () => {
    const found = findNameConflict(existing, {
      shareGroupId: 'g1',
      ownerId: null,
      kind: 'income',
      name: '食費',
    });
    expect(found).toBeNull();
  });

  it('列5 アーカイブ済みも衝突として数える', () => {
    const found = findNameConflict([cat({ isArchived: true })], {
      shareGroupId: 'g1',
      ownerId: null,
      kind: 'expense',
      name: '食費',
    });
    expect(found?.id).toBe('c1');
  });

  it('列3 前後の空白は落としてから比べる', () => {
    const found = findNameConflict(existing, {
      shareGroupId: 'g1',
      ownerId: null,
      kind: 'expense',
      name: ' 食費 ',
    });
    expect(found?.id).toBe('c1');
  });

  it('自分自身とは衝突しない（編集のとき）', () => {
    const found = findNameConflict(
      existing,
      { shareGroupId: 'g1', ownerId: null, kind: 'expense', name: '食費' },
      'c1',
    );
    expect(found).toBeNull();
  });
});

describe('scopeKey', () => {
  it('共有範囲を1つの文字列で表す', () => {
    expect(scopeKey('g1', null)).toBe('group:g1');
    expect(scopeKey(null, 'u1')).toBe('own:u1');
  });
});
