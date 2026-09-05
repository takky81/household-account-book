/**
 * カテゴリの表示順（決定表「カテゴリの管理」列14）。
 *
 * 並びは共有範囲 × 収支区分の中だけで意味を持つ。DB は sort_order 昇順・
 * 名前昇順で読む（§3.4）ため、入れ替えたら 10 刻みで振り直して同値をなくす。
 */

export type Orderable = { id: string; sortOrder: number };

const STEP = 10;

/**
 * 1つ上（下）と入れ替えた並びを、値の変わるものだけ返す。
 * 端にいる、または見つからないときは空。
 */
export function reorder(items: Orderable[], id: string, direction: 'up' | 'down'): Orderable[] {
  const index = items.findIndex((item) => item.id === id);
  const target = items[index];
  const to = direction === 'up' ? index - 1 : index + 1;
  if (target === undefined || to < 0 || to >= items.length) return [];
  const rest = items.filter((item) => item.id !== id);
  const next = [...rest.slice(0, to), target, ...rest.slice(to)];
  const before = new Map(items.map((item) => [item.id, item.sortOrder]));
  return next
    .map((item, position) => ({ id: item.id, sortOrder: (position + 1) * STEP }))
    .filter((item) => item.sortOrder !== before.get(item.id));
}

/** 追加するカテゴリの表示順。同じ共有範囲の末尾に置く。 */
export function nextSortOrder(items: Orderable[]): number {
  return items.reduce((max, item) => Math.max(max, item.sortOrder), 0) + STEP;
}
