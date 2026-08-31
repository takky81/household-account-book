import { describe, it, expect } from 'vitest';
import { fetchAll, PAGE_SIZE, type Page } from './paged';

/**
 * 指定した件数を持つ擬似的な取得。
 * cap はサーバ側が1回に返す上限で、頼んだ幅より小さいこともある。
 */
function source(total: number, options: { cap?: number; countable?: boolean } = {}) {
  const calls: [number, number][] = [];
  const rows = Array.from({ length: total }, (_, i) => i);
  const cap = options.cap ?? Infinity;
  return {
    calls,
    fetchPage: async (from: number, to: number): Promise<Page<number>> => {
      calls.push([from, to]);
      const width = Math.min(to - from + 1, cap);
      return {
        rows: rows.slice(from, from + width),
        total: options.countable === false ? null : total,
      };
    },
  };
}

describe('fetchAll（決定表「出題順」列16・「学習履歴の集計」列20）', () => {
  it('上限を超えても全件を取る', async () => {
    const { fetchPage, calls } = source(2500);
    const all = await fetchAll(fetchPage, 1000);
    expect(all).toHaveLength(2500);
    expect(all[2499]).toBe(2499);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('上限に満たなければ1回で終わる', async () => {
    const { fetchPage, calls } = source(3);
    expect(await fetchAll(fetchPage, 1000)).toHaveLength(3);
    expect(calls).toHaveLength(1);
  });

  it('ちょうど上限のときに余計な往復をしない', async () => {
    const { fetchPage, calls } = source(1000);
    expect(await fetchAll(fetchPage, 1000)).toHaveLength(1000);
    expect(calls).toHaveLength(1);
  });

  it('サーバ側の上限が頼んだ幅より小さくても全件を取る', async () => {
    // 1000件ずつ頼んでも 400件ずつしか返らない場合
    const { fetchPage, calls } = source(1001, { cap: 400 });
    expect(await fetchAll(fetchPage, 1000)).toHaveLength(1001);
    // 3回目で 1001 件に届くので、余計な往復はしない
    expect(calls).toEqual([
      [0, 999],
      [400, 1399],
      [800, 1799],
    ]);
  });

  it('件数が分からなければ、満たない応答を終わりとみなす', async () => {
    const { fetchPage, calls } = source(1500, { countable: false });
    expect(await fetchAll(fetchPage, 1000)).toHaveLength(1500);
    expect(calls).toHaveLength(2);
  });

  it('1件もなければ空を返す', async () => {
    const { fetchPage } = source(0);
    expect(await fetchAll(fetchPage, 1000)).toEqual([]);
  });

  it('既定の上限は Supabase の max_rows と揃える', () => {
    expect(PAGE_SIZE).toBe(1000);
  });
});
