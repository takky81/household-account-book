/**
 * 定期登録ルールの入力検査（決定表「定期登録ルールの管理」列3・列4・列5・列6）。
 *
 * 同じ検査は DB 側（upsert_recurring_rule と制約）にもある。ここは保存を押す前に
 * 画面で知らせるためのもの。規則を変えるときは両方を直す。
 */

import type { Validation } from '../auth/validation';
import { formatAmount } from '../../lib/money';
import type { Split } from '../../lib/split';

export type RecurringRuleInput = {
  categoryId: string;
  amount: number;
  dayOfMonth: number;
  /** 開始月・終了月（YYYY-MM）。終了月の null は無期限 */
  startMonth: string;
  endMonth: string | null;
  /** 手で決めた負担の雛形。省略すると生成のたびに既定按分する */
  splits?: Split[];
};

export function validateRecurringRule(input: RecurringRuleInput): Validation {
  if (input.categoryId === '') {
    return { ok: false, message: 'カテゴリを選んでください' };
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { ok: false, message: '金額は1以上の整数にしてください' };
  }
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31) {
    return { ok: false, message: '支払日は1〜31の日にしてください' };
  }
  if (!/^\d{4}-\d{2}$/.test(input.startMonth)) {
    return { ok: false, message: '開始月を指定してください' };
  }
  if (input.endMonth !== null && input.endMonth < input.startMonth) {
    return { ok: false, message: '終了月は開始月以降にしてください' };
  }

  const splits = input.splits;
  if (splits !== undefined) {
    if (splits.length === 0) {
      return { ok: false, message: '負担が空です' };
    }
    if (splits.some((s) => !Number.isInteger(s.amount) || s.amount < 0)) {
      return { ok: false, message: '負担額は0以上の整数にしてください' };
    }
    if (new Set(splits.map((s) => s.userId)).size !== splits.length) {
      return { ok: false, message: '同じ人が負担に2回現れています' };
    }
    const total = splits.reduce((sum, s) => sum + s.amount, 0);
    if (total !== input.amount) {
      return {
        ok: false,
        message: `負担の合計 ${formatAmount(total)} が金額 ${formatAmount(input.amount)} と一致しません`,
      };
    }
  }

  return { ok: true };
}
