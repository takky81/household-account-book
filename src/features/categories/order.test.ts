import { describe, it, expect } from 'vitest';
import { nextSortOrder, reorder } from './order';

const items = [
  { id: 'a', sortOrder: 10 },
  { id: 'b', sortOrder: 20 },
  { id: 'c', sortOrder: 30 },
];

describe('カテゴリの表示順', () => {
  it('列14 上へ動かすと1つ前と入れ替わる', () => {
    expect(reorder(items, 'c', 'up')).toEqual([
      { id: 'c', sortOrder: 20 },
      { id: 'b', sortOrder: 30 },
    ]);
  });

  it('列14 下へ動かすと1つ後と入れ替わる', () => {
    expect(reorder(items, 'a', 'down')).toEqual([
      { id: 'b', sortOrder: 10 },
      { id: 'a', sortOrder: 20 },
    ]);
  });

  it('列14 端では動かない', () => {
    expect(reorder(items, 'a', 'up')).toEqual([]);
    expect(reorder(items, 'c', 'down')).toEqual([]);
  });

  it('列14 表示順が同じでも並びの通りに振り直す', () => {
    const flat = [
      { id: 'a', sortOrder: 100 },
      { id: 'b', sortOrder: 100 },
    ];
    expect(reorder(flat, 'b', 'up')).toEqual([
      { id: 'b', sortOrder: 10 },
      { id: 'a', sortOrder: 20 },
    ]);
  });

  it('列14 追加したカテゴリは末尾に置く', () => {
    expect(nextSortOrder(items)).toBe(40);
    expect(nextSortOrder([])).toBe(10);
  });
});
