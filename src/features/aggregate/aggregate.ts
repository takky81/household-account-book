/**
 * 月次集計（docs/仕様書.md §5.4 / §5.5）。決定表「集計」に対応する。
 *
 * 軸は2つ。対象範囲（自分に関わるすべて / 共有グループごと / 個人のみ）と、
 * 集計基準（負担額 / 支払額）。予算の実績はこの軸に従わない（§5.6）。
 */

import type { Kind } from '../categories/name';
import { monthKeyOf } from '../../lib/date';
import { scopeKey } from '../categories/name';

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
  kind: Kind;
  shareGroupId: string | null;
  ownerId: string | null;
  amount: number;
  payerId: string | null;
  splits: { userId: string; amount: number }[];
};

export type CategoryTotal = {
  categoryId: string;
  name: string;
  /** 共有範囲。同じ名前でも範囲が違えば別の行になる */
  scopeLabel: 'group' | 'individual';
  shareGroupId: string | null;
  amount: number;
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
      const key = tx.categoryId;
      const found = byCategory.get(key);
      if (found) found.amount += amount;
      else
        byCategory.set(key, {
          categoryId: tx.categoryId,
          name: tx.categoryName,
          scopeLabel: tx.shareGroupId !== null ? 'group' : 'individual',
          shareGroupId: tx.shareGroupId,
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
    byCategory: [...byCategory.values()].sort((a, b) => b.amount - a.amount),
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
