/**
 * 共有範囲の変更（docs/仕様書.md §2.8 / §5.2）。決定表「共有範囲の変更」に対応する。
 *
 * 実際の移動は RPC（move_category_scope / move_transactions）が原子的に行い、
 * 同じ検査を DB 側でもやり直す。ここは実行前に件数と理由を画面に出すためのもの。
 */

import { findNameConflict, type CategoryLike, type Kind, type Scope } from '../categories/name';

export type MoveTx = {
  id: string;
  payerId: string | null;
  splitUserIds: string[];
  splitsAreManual: boolean;
  amount: number;
};

export type MoveCheck =
  | { ok: true }
  | { ok: false; reason: 'not-member'; message: string }
  | { ok: false; reason: 'name-conflict'; message: string; conflictId: string }
  | { ok: false; reason: 'others-involved'; message: string; count: number }
  | { ok: false; reason: 'non-member-payer'; message: string; count: number };

/** 共有範囲が変わるか。変わるときだけ負担を作り直す（§2.8）。 */
export function scopeChanged(a: Scope, b: Scope): boolean {
  return a.shareGroupId !== b.shareGroupId || a.ownerId !== b.ownerId;
}

/** 手で直した負担を持つ取引の件数（列11）。作り直す前に確認に出す。 */
export function manualCount(transactions: MoveTx[]): number {
  return transactions.filter((tx) => tx.splitsAreManual).length;
}

export function checkMove(input: {
  source: Scope;
  dest: Scope;
  kind: Kind;
  name: string;
  categories: CategoryLike[];
  transactions: MoveTx[];
  destMemberIds: string[];
  selfId: string;
  myGroupIds: string[];
  sourceCategoryId: string;
  /** 取引をまとめて付け替える経路では、移動先が既存カテゴリなので同名の検査をしない */
  skipNameCheck?: boolean;
}): MoveCheck {
  const { source, dest, transactions, destMemberIds, selfId, myGroupIds } = input;

  // 手順0。移動先の共有範囲に自分が属すること。
  // 支払者の検査は取引0件のカテゴリを素通りさせるので、これの代わりにはならない
  if (dest.shareGroupId !== null) {
    if (!myGroupIds.includes(dest.shareGroupId)) {
      return { ok: false, reason: 'not-member', message: '移動先グループのメンバーではありません' };
    }
  } else if (dest.ownerId !== selfId) {
    return { ok: false, reason: 'not-member', message: '移動先は自分の個人範囲だけです' };
  }

  // 手順2。アーカイブ済みも一意性の判定に含むので、画面に出ていないものと衝突しうる
  if (!input.skipNameCheck) {
    const conflict = findNameConflict(
      input.categories,
      { ...dest, kind: input.kind, name: input.name },
      input.sourceCategoryId,
    );
    if (conflict !== null) {
      return {
        ok: false,
        reason: 'name-conflict',
        message: `移動先に同じ名前の「${conflict.name}」があります`,
        conflictId: conflict.id,
      };
    }
  }

  if (dest.shareGroupId === null) {
    // 手順3。移動先が個人。共用払いもここで弾く
    const bad = transactions.filter(
      (tx) =>
        tx.payerId !== dest.ownerId || tx.splitUserIds.some((id) => id !== dest.ownerId),
    );
    if (bad.length > 0) {
      return {
        ok: false,
        reason: 'others-involved',
        message: `他の人が支払った、または負担している取引が ${bad.length} 件あります`,
        count: bad.length,
      };
    }
  } else {
    // 手順4。共用払い（payerId が null）は共有から共有への移動では許す
    const bad = transactions.filter(
      (tx) => tx.payerId !== null && !destMemberIds.includes(tx.payerId),
    );
    if (bad.length > 0) {
      return {
        ok: false,
        reason: 'non-member-payer',
        message: `移動先グループのメンバーでない人が支払った取引が ${bad.length} 件あります`,
        count: bad.length,
      };
    }
  }

  void source;
  return { ok: true };
}
