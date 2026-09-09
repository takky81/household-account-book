/** DB の行を、集計・書き出し・移動の判定が使う形に直す橋渡し。 */

import type { Category, Transaction } from '../../lib/db';
import type { AggregateTx } from '../aggregate/aggregate';
import type { TreeCategory } from '../categories/tree';
import type { MoveTx } from '../scope/move';
import type { ExportTx } from '../transfer/export';

/**
 * DB の行を、カテゴリを扱う共通の形（tree.ts）へ。
 * CategoryLike（name.ts / move.ts / usage.ts が使う）はこの形の部分集合なので、
 * 変換はこれ1つでよい。
 */
export function toTreeCategory(category: Category): TreeCategory {
  return {
    id: category.id,
    parentId: category.parent_id,
    name: category.name,
    kind: category.kind,
    sortOrder: category.sort_order,
    isSystem: category.is_system,
    isArchived: category.is_archived,
  };
}

export function toAggregateTx(transactions: Transaction[], categories: Category[]): AggregateTx[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return transactions.flatMap((tx) => {
    const category = byId.get(tx.category_id);
    if (category === undefined) return [];
    return [
      {
        id: tx.id,
        occurredOn: tx.occurred_on,
        categoryId: tx.category_id,
        categoryName: category.name,
        parentId: category.parent_id,
        parentName:
          category.parent_id === null ? null : (byId.get(category.parent_id)?.name ?? null),
        kind: category.kind,
        // 共有範囲は取引が持つ（§2.4）。カテゴリからはもう決まらない
        shareGroupId: tx.share_group_id,
        ownerId: tx.owner_id,
        amount: tx.amount,
        payerId: tx.payer_id,
        splits: tx.transaction_splits.map((s) => ({ userId: s.user_id, amount: s.amount })),
      },
    ];
  });
}

export function toExportTx(transactions: Transaction[], categories: Category[]): ExportTx[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return transactions.flatMap((tx) => {
    const category = byId.get(tx.category_id);
    if (category === undefined) return [];
    return [
      {
        occurredOn: tx.occurred_on,
        kind: category.kind,
        shareGroupId: tx.share_group_id,
        ownerId: tx.owner_id,
        // CSV は「カテゴリ」に大分類、「小分類」にその名前を書く（§4.2）
        categoryName:
          category.parent_id === null
            ? category.name
            : (byId.get(category.parent_id)?.name ?? category.name),
        subcategoryName: category.parent_id === null ? null : category.name,
        amount: tx.amount,
        payerId: tx.payer_id,
        splits: tx.transaction_splits.map((s) => ({ userId: s.user_id, amount: s.amount })),
        memo: tx.memo,
      },
    ];
  });
}

export function toMoveTx(transactions: Transaction[]): MoveTx[] {
  return transactions.map((tx) => ({
    id: tx.id,
    payerId: tx.payer_id,
    splitUserIds: tx.transaction_splits.map((s) => s.user_id),
    splitsAreManual: tx.splits_are_manual,
    amount: tx.amount,
  }));
}

/** カテゴリごとの支出総額（予算の実績。§5.6） */
export function actualsByCategory(transactions: Transaction[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const tx of transactions) {
    totals[tx.category_id] = (totals[tx.category_id] ?? 0) + tx.amount;
  }
  return totals;
}

/** カテゴリごとの自分の負担（参考値） */
export function selfBurdenByCategory(
  transactions: Transaction[],
  selfId: string,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const tx of transactions) {
    const mine = tx.transaction_splits.find((s) => s.user_id === selfId);
    if (mine === undefined) continue;
    totals[tx.category_id] = (totals[tx.category_id] ?? 0) + mine.amount;
  }
  return totals;
}

/** ブラウザにファイルを渡す。 */
export function downloadCsv(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
