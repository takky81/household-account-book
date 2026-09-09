/**
 * カテゴリの階層（docs/仕様書.md §3.4.1）。決定表「カテゴリの管理」列15〜列24 に対応する。
 *
 * 階層は2段まで。親を持たないものが大分類、その下に置くものが小分類で、
 * 小分類の収支区分は親と同じ（DB のトリガが親からコピーする）。
 * カテゴリは全ユーザー共通で、共有範囲は持たない（§2.4）。
 * ここは画面が並べ替え・候補・表示名を決めるための判定。
 */

import type { Kind } from './name';

export type TreeCategory = {
  id: string;
  parentId: string | null;
  name: string;
  kind: Kind;
  sortOrder: number;
  isSystem: boolean;
  isArchived: boolean;
};

/** 表示順。昇順、同値なら名前順（DB の読み出しと揃える。§3.4） */
function byOrder<T extends TreeCategory>(a: T, b: T): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** 集計・予算がまとめる単位。小分類は親の id に畳む。 */
export function rootIdOf(category: { id: string; parentId: string | null }): string {
  return category.parentId ?? category.id;
}

/** 親になれるのは、未分類でない大分類だけ（階層は2段まで）。 */
export function canBeParent(category: TreeCategory): boolean {
  return category.parentId === null && !category.isSystem;
}

export function childrenOf<T extends TreeCategory>(categories: T[], parentId: string): T[] {
  return categories.filter((c) => c.parentId === parentId).sort(byOrder);
}

/** 親ごとの小分類。1回の走査でまとめる（行ごとに絞り込むと件数の2乗になる）。 */
function groupByParent<T extends TreeCategory>(categories: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const category of categories) {
    if (category.parentId === null) continue;
    const found = map.get(category.parentId);
    if (found === undefined) map.set(category.parentId, [category]);
    else found.push(category);
  }
  for (const children of map.values()) children.sort(byOrder);
  return map;
}

/** 兄弟を決めるのに要るものだけ。まだ作っていないカテゴリにも使える（列15） */
export type SiblingKey = Pick<TreeCategory, 'parentId' | 'kind'>;

/**
 * 並べ替えの単位（列14・列23）。小分類なら同じ親の小分類、大分類なら
 * 同じ収支区分の大分類。未分類は常に末尾なので対象にしない。
 */
export function siblingsOf<T extends TreeCategory>(categories: T[], target: SiblingKey): T[] {
  if (target.parentId !== null) return childrenOf(categories, target.parentId);
  return categories
    .filter((c) => c.parentId === null && !c.isSystem && c.kind === target.kind)
    .sort(byOrder);
}

/**
 * 新規入力の候補に出すか（列8・列22）。
 * 親がアーカイブ済みなら、子の is_archived が false でも候補から外す。
 */
export function isSelectable(categories: TreeCategory[], category: TreeCategory): boolean {
  if (category.isArchived) return false;
  if (category.parentId === null) return true;
  const parent = categories.find((c) => c.id === category.parentId);
  return parent !== undefined && !parent.isArchived;
}

/** 大分類の直後にその小分類が並ぶ順（画面・選択肢の共通の並び）。 */
export function orderedTree<T extends TreeCategory>(
  categories: T[],
): { root: T; children: T[] }[] {
  const byParent = groupByParent(categories);
  return categories
    .filter((c) => c.parentId === null)
    .sort(byOrder)
    .map((root) => ({ root, children: byParent.get(root.id) ?? [] }));
}

/** 候補に出せるものだけを、ツリーの順で並べる。 */
export function selectableCategories<T extends TreeCategory>(categories: T[]): T[] {
  return orderedTree(categories)
    .filter(({ root }) => isSelectable(categories, root))
    .flatMap(({ root, children }) => [
      root,
      ...children.filter((c) => isSelectable(categories, c)),
    ]);
}

/** 表示名。小分類は『大分類 / 小分類』（§3.4.1）。 */
export function categoryPath(categories: TreeCategory[], category: TreeCategory): string {
  if (category.parentId === null) return category.name;
  const parent = categories.find((c) => c.id === category.parentId);
  return parent === undefined ? category.name : `${parent.name} / ${category.name}`;
}
