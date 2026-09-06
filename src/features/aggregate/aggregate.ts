/**
 * 月次集計（docs/仕様書.md §5.4 / §5.5）。決定表「集計」に対応する。
 *
 * 軸は2つ。対象範囲（自分に関わるすべて / 共有グループごと / 個人のみ）と、
 * 集計基準（負担額 / 支払額）。予算の実績はこの軸に従わない（§5.6）。
 */

import type { Kind } from '../categories/name';
import { monthKeyOf } from '../../lib/date';
import { scopeKey } from '../categories/name';
import { rootIdOf } from '../categories/tree';

/** 支払額基準で、支払者のいない（共用の財布から出した）取引をまとめる枠。 */
export const SHARED_PAYER = 'shared';

export type Basis = 'burden' | 'payment';

export type ScopeFilter =
  | { kind: 'all' }
  | { kind: 'group'; shareGroupId: string }
  | { kind: 'own' };

export type AggregateTx = {
  id: string;
  occurredOn: string;
  categoryId: string;
  categoryName: string;
  /** 小分類なら親の大分類。内訳はこの単位で集約する（§5.4） */
  parentId?: string | null;
  parentName?: string | null;
  kind: Kind;
  shareGroupId: string | null;
  ownerId: string | null;
  amount: number;
  payerId: string | null;
  splits: { userId: string; amount: number }[];
};

/** 大分類そのものに付いた取引を、小分類と並べて見せるときの名前（§5.4）。 */
export const NO_SUBCATEGORY = '（小分類なし）';

export type CategoryChild = { categoryId: string; name: string; amount: number };

export type CategoryTotal = {
  /** 大分類の id。小分類の取引もここに畳む */
  categoryId: string;
  name: string;
  /** 共有範囲。同じ名前でも範囲が違えば別の行になる */
  scopeLabel: 'group' | 'individual';
  shareGroupId: string | null;
  /** 配下の小分類を含んだ合計 */
  amount: number;
  /** 小分類ごとの内訳。小分類の取引が無ければ空 */
  children: CategoryChild[];
};

export type UserTotal = { userId: string; amount: number };

export type MonthTotals = {
  income: number;
  expense: number;
  balance: number;
  byCategory: CategoryTotal[];
  byUser: UserTotal[];
};

export type Members = Record<string, string[]>;

/** 集計で額を数える相手（§5.4）。 */
export function targetUsers(scope: ScopeFilter, selfId: string, members: Members): string[] {
  if (scope.kind === 'group') return members[scope.shareGroupId] ?? [];
  return [selfId];
}

function inScope(tx: AggregateTx, scope: ScopeFilter, selfId: string): boolean {
  switch (scope.kind) {
    case 'group':
      return tx.shareGroupId === scope.shareGroupId;
    case 'own':
      return tx.shareGroupId === null && tx.ownerId === selfId;
    case 'all':
      return tx.shareGroupId !== null || tx.ownerId === selfId;
  }
}

/**
 * その取引のうち、対象の利用者に属する額（§5.4 の「集計対象額」）。
 *
 * 支払額基準では、共用（payerId が null）の取引は誰にも属さない。ただしグループ単位で
 * 見るときは「共用」の枠を合計に含める。そうしないと、どちらの基準でも合計が
 * グループの支出総額に一致する、という性質が崩れる。
 */
function amountFor(
  tx: AggregateTx,
  basis: Basis,
  users: string[],
  includeShared: boolean,
): number {
  if (basis === 'burden') {
    return tx.splits
      .filter((s) => users.includes(s.userId))
      .reduce((sum, s) => sum + s.amount, 0);
  }
  if (tx.payerId === null) return includeShared ? tx.amount : 0;
  return users.includes(tx.payerId) ? tx.amount : 0;
}

export function aggregateMonth(input: {
  transactions: AggregateTx[];
  monthKey: string;
  scope: ScopeFilter;
  basis: Basis;
  selfId: string;
  members: Members;
}): MonthTotals {
  const { transactions, monthKey, scope, basis, selfId, members } = input;
  const users = targetUsers(scope, selfId, members);
  const rows = transactions.filter(
    (tx) => monthKeyOf(tx.occurredOn) === monthKey && inScope(tx, scope, selfId),
  );

  let income = 0;
  let expense = 0;
  const byCategory = new Map<string, CategoryTotal>();
  const byUser = new Map<string, number>();

  // グループを見るときは、現メンバーとデータに現れる人の和集合を並べる（§3.3）
  if (scope.kind === 'group') {
    for (const userId of users) byUser.set(userId, 0);
  }

  for (const tx of rows) {
    const amount = amountFor(tx, basis, users, scope.kind === 'group');
    if (tx.kind === 'income') income += amount;
    else expense += amount;

    if (amount !== 0 && tx.kind === 'expense') {
      // 内訳は大分類で集約する。小分類の取引は親の行に足し、内訳として持つ
      const rootId = rootIdOf({ id: tx.categoryId, parentId: tx.parentId ?? null });
      let row = byCategory.get(rootId);
      if (row === undefined) {
        row = {
          categoryId: rootId,
          name: tx.parentName ?? tx.categoryName,
          scopeLabel: tx.shareGroupId !== null ? 'group' : 'individual',
          shareGroupId: tx.shareGroupId,
          amount: 0,
          children: [],
        };
        byCategory.set(rootId, row);
      }
      row.amount += amount;
      // 大分類そのものに付いた取引は、小分類と並べるとき『（小分類なし）』になる
      const child = row.children.find((c) => c.categoryId === tx.categoryId);
      if (child !== undefined) child.amount += amount;
      else
        row.children.push({
          categoryId: tx.categoryId,
          name: tx.parentId == null ? NO_SUBCATEGORY : tx.categoryName,
          amount,
        });
    }

    if (scope.kind === 'group' && tx.kind === 'expense') {
      if (basis === 'burden') {
        for (const split of tx.splits) {
          byUser.set(split.userId, (byUser.get(split.userId) ?? 0) + split.amount);
        }
      } else {
        const key = tx.payerId ?? SHARED_PAYER;
        byUser.set(key, (byUser.get(key) ?? 0) + tx.amount);
      }
    }
  }

  return {
    income,
    expense,
    balance: income - expense,
    byCategory: [...byCategory.values()]
      .map((row) => {
        // 小分類の取引が1件も無ければ内訳を出さない（大分類そのものの1行だけにしない）
        const onlyRoot = row.children.length === 1 && row.children[0]!.categoryId === row.categoryId;
        if (onlyRoot) row.children = [];
        else row.children.sort((a, b) => b.amount - a.amount);
        return row;
      })
      .sort((a, b) => b.amount - a.amount),
    byUser: [...byUser.entries()]
      .map(([userId, amount]) => ({ userId, amount }))
      .sort((a, b) => b.amount - a.amount || (a.userId < b.userId ? -1 : 1)),
  };
}

/** 前月比（§5.5）。当月の支出合計から前月を引く。 */
export function monthDiff(current: MonthTotals, previous: MonthTotals): number {
  return current.expense - previous.expense;
}

/** 共有範囲つきの表示名。名前が同じでも範囲が違えば別物として見せる。 */
export function scopeOf(tx: { shareGroupId: string | null; ownerId: string | null }): string {
  return scopeKey(tx.shareGroupId, tx.ownerId);
}

/** 円グラフの色数（src/index.css の --c-cat-*）。最後の1色は「その他」に使う。 */
export const PIE_COLORS = 7;

export type Slice = {
  /** カテゴリ行と同じ鍵。まとめた分は 'other' */
  key: string;
  name: string;
  amount: number;
  /** 全体に占める割合（0〜1） */
  ratio: number;
  /** --c-cat-n の n */
  colorIndex: number;
};

/**
 * カテゴリ別の内訳を円グラフ用に切り分ける（§5.5）。
 * 色で見分けられる数に限りがあるので、上位 PIE_COLORS-1 件までを出し、残りは「その他」にまとめる。
 */
export function categorySlices(rows: CategoryTotal[]): Slice[] {
  const positive = rows.filter((row) => row.amount > 0);
  const total = positive.reduce((sum, row) => sum + row.amount, 0);
  if (total === 0) return [];

  const head = positive.slice(0, PIE_COLORS - 1);
  const tail = positive.slice(PIE_COLORS - 1);
  const slices = head.map((row, i) => ({
    key: row.categoryId,
    name: row.name,
    amount: row.amount,
    ratio: row.amount / total,
    colorIndex: i + 1,
  }));

  if (tail.length > 0) {
    const amount = tail.reduce((sum, row) => sum + row.amount, 0);
    slices.push({
      key: 'other',
      name: 'その他',
      amount,
      ratio: amount / total,
      colorIndex: PIE_COLORS,
    });
  }
  return slices;
}
