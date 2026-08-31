/**
 * 取引の入力検査（決定表「取引の入力と編集」列4・列5・列6・列8・列9・列10・列14）。
 *
 * 同じ検査は DB 側（トリガと upsert_transaction）にもある。ここは保存を押す前に
 * 画面で知らせるためのもの。片方だけ直すとずれるので、規則を変えるときは両方を直す。
 */

import type { Validation } from '../auth/validation';
import { formatAmount } from '../../lib/money';
import type { Split } from '../../lib/split';

export type TransactionInput = {
  amount: number;
  /** 個人カテゴリか */
  isPersonal: boolean;
  /** 個人カテゴリのときの所有者 */
  ownerId: string | null;
  /** 支払った人。null は「共用」 */
  payerId: string | null;
  /** 共有範囲のメンバー。個人カテゴリでは所有者1人だけ */
  memberIds: string[];
  splits: Split[];
  /**
   * 編集で、支払者が読み込んだときのままか。true のときは支払者がメンバーかどうかを見ない。
   * DB の transactions_check_payer も値が実際に変わるときしか発火しないので、脱退した人が
   * 支払者のままの取引でも備考だけを直せる（列11 / §3.5）。
   * 負担の相手はいつでも今のメンバーでなければならない（DB の splits_check_member と同じ）。
   */
  payerUnchanged?: boolean;
};

export function validateTransaction(input: TransactionInput): Validation {
  const { amount, isPersonal, ownerId, payerId, memberIds, splits } = input;

  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, message: '金額は1以上の整数にしてください' };
  }

  // 個人カテゴリの共有範囲のメンバーは所有者1人だけ（§3.6）
  const members = isPersonal && ownerId !== null ? [ownerId] : memberIds;

  const checkPayer = input.payerUnchanged !== true;

  if (isPersonal && checkPayer) {
    if (payerId === null) {
      return { ok: false, message: '個人カテゴリの支払者は本人だけです' };
    }
    if (payerId !== ownerId) {
      return { ok: false, message: '個人カテゴリの支払者は本人だけです' };
    }
  } else if (checkPayer && payerId !== null && !members.includes(payerId)) {
    return { ok: false, message: '支払者がその共有グループのメンバーではありません' };
  }

  if (splits.length === 0) {
    return { ok: false, message: '負担が空です' };
  }
  if (splits.some((s) => !Number.isInteger(s.amount) || s.amount < 0)) {
    return { ok: false, message: '負担額は0以上の整数にしてください' };
  }
  if (new Set(splits.map((s) => s.userId)).size !== splits.length) {
    return { ok: false, message: '同じ人が負担に2回現れています' };
  }
  if (splits.some((s) => !members.includes(s.userId))) {
    return { ok: false, message: '負担の相手がその共有範囲のメンバーではありません' };
  }

  const total = splits.reduce((sum, s) => sum + s.amount, 0);
  if (total !== amount) {
    return {
      ok: false,
      message: `負担の合計 ${formatAmount(total)} が金額 ${formatAmount(amount)} と一致しません`,
    };
  }

  return { ok: true };
}
