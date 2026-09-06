/**
 * CSV の書き出し（docs/仕様書.md §4.2 / §4.3）。決定表「CSVエクスポート」に対応する。
 *
 * 取引以外は書き出し専用。共有範囲の指し方は取引 CSV に揃える（グループ名、または `個人`）。
 */

import { toCsv } from '../../lib/csv';
import { monthKeyOf } from '../../lib/date';
import type { CategoryLike, Kind } from '../categories/name';
import { orderedTree } from '../categories/tree';
import type { MemberLike } from '../groups/members';

/** 支払者なしを表す予約語。表示名には使えない（§4.2）。 */
export const SHARED_LABEL = '共用';
/** 個人の共有範囲を表す予約語。グループ名には使えない（§3.2）。 */
export const OWN_LABEL = '個人';

export type Names = Record<string, string>;

export const TRANSACTION_HEADER = [
  '日付',
  '収支',
  '共有範囲',
  'カテゴリ',
  '小分類',
  '金額',
  '支払者',
  '負担',
  '備考',
];

export function kindLabel(kind: Kind): string {
  return kind === 'income' ? '収入' : '支出';
}

export function scopeLabel(shareGroupId: string | null, groupNames: Names): string {
  return shareGroupId !== null ? (groupNames[shareGroupId] ?? '') : OWN_LABEL;
}

export type ExportTx = {
  occurredOn: string;
  kind: Kind;
  shareGroupId: string | null;
  ownerId: string | null;
  /** 大分類の名前 */
  categoryName: string;
  /** 小分類の名前。大分類そのものに付いた取引は null（§4.2） */
  subcategoryName: string | null;
  amount: number;
  payerId: string | null;
  splits: { userId: string; amount: number }[];
  memo: string;
};

/**
 * 負担は `表示名:金額` を `;` で連結する。書き出しでは常に明示する（§4.2）。
 *
 * 読み込んだ順は決まらないので表示名で並べる。表示名は一意（profiles_display_name_uq）
 * だが、まだ読んでいない利用者は空文字になるため利用者IDで決着をつける。
 */
function splitsLabel(splits: ExportTx['splits'], names: Names): string {
  const label = (userId: string) => names[userId] ?? '';
  return [...splits]
    .sort((a, b) => {
      const [x, y] = [label(a.userId), label(b.userId)];
      if (x !== y) return x < y ? -1 : 1;
      return a.userId < b.userId ? -1 : 1;
    })
    .map((s) => `${label(s.userId)}:${s.amount}`)
    .join(';');
}

export function transactionCsv(rows: ExportTx[], names: Names, groupNames: Names): string {
  return toCsv(
    TRANSACTION_HEADER,
    rows.map((tx) => [
      tx.occurredOn,
      kindLabel(tx.kind),
      scopeLabel(tx.shareGroupId, groupNames),
      tx.categoryName,
      tx.subcategoryName ?? '',
      String(tx.amount),
      tx.payerId === null ? SHARED_LABEL : (names[tx.payerId] ?? ''),
      splitsLabel(tx.splits, names),
      tx.memo,
    ]),
  );
}

export type ExportCategory = CategoryLike & {
  color: string;
  sortOrder: number;
  isSystem: boolean;
};

const yesNo = (value: boolean) => (value ? 'はい' : 'いいえ');

export function categoryCsv(categories: ExportCategory[], groupNames: Names): string {
  // 小分類の行は「カテゴリ」に親の名前を書く（§4.3）
  const row = (category: ExportCategory, parentName: string | null) => [
    scopeLabel(category.shareGroupId, groupNames),
    kindLabel(category.kind),
    parentName ?? category.name,
    parentName === null ? '' : category.name,
    category.color,
    String(category.sortOrder),
    yesNo(category.isSystem),
    yesNo(category.isArchived),
  ];
  return toCsv(
    ['共有範囲', '収支', 'カテゴリ', '小分類', '色', '表示順', '未分類', 'アーカイブ済み'],
    // 親の行を先に、続けてその小分類を並べる。並びは画面と同じ規則（§3.4）
    orderedTree(categories).flatMap(({ root, children }) => [
      row(root, null),
      ...children.map((child) => row(child, root.name)),
    ]),
  );
}

export function budgetCsv(
  budgets: { categoryId: string; month: string; amount: number }[],
  categories: CategoryLike[],
  groupNames: Names,
): string {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return toCsv(
    ['共有範囲', '収支', 'カテゴリ', '対象月', '予算額'],
    budgets.flatMap((b) => {
      const category = byId.get(b.categoryId);
      if (category === undefined) return [];
      return [
        [
          scopeLabel(category.shareGroupId, groupNames),
          kindLabel(category.kind),
          category.name,
          // 対象月は日付ではないので YYYY-MM で書く（§4.3）
          monthKeyOf(b.month),
          String(b.amount),
        ],
      ];
    }),
  );
}

export function groupCsv(
  groups: { id: string; name: string }[],
  members: Record<string, MemberLike[]>,
  names: Names,
): string {
  return toCsv(
    ['グループ', 'メンバー', '負担割合', '表示順'],
    // メンバー1人を1行として書き出す
    groups.flatMap((g) =>
      (members[g.id] ?? []).map((m) => [
        g.name,
        names[m.userId] ?? '',
        String(m.defaultWeight),
        String(m.sortOrder),
      ]),
    ),
  );
}

/** 書き出せる対象。期間を指定できるのは取引と予算だけ（§4.5）。 */
export type ExportTarget = 'transactions' | 'categories' | 'budgets' | 'groups';

export function canSpecifyPeriod(target: ExportTarget): boolean {
  return target === 'transactions' || target === 'budgets';
}

/** 対象月で絞る。null なら全期間。 */
export function filterByMonth<T extends { occurredOn: string }>(
  rows: T[],
  monthKey: string | null,
): T[] {
  if (monthKey === null) return rows;
  return rows.filter((row) => monthKeyOf(row.occurredOn) === monthKey);
}
