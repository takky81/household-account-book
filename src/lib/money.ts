/**
 * 金額（docs/仕様書.md §3）。すべて円単位の整数で持ち、小数は扱わない。
 * 決定表「取引の入力と編集」列6 に対応する。
 */

/**
 * 入力された金額を整数にする。読めなければ null。
 * 桁区切りと通貨記号は入力時だけ許す（書き出しでは付けない。§4.2）。
 */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[,\s¥￥円]/g, '');
  if (cleaned === '' || !/^-?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

/** 桁区切りを付ける。 */
export function formatAmount(value: number): string {
  return value.toLocaleString('ja-JP');
}

/** 収支の向きに応じた符号付き。向きはカテゴリの kind が持つ。 */
export function formatSigned(value: number, kind: 'income' | 'expense'): string {
  return (kind === 'income' ? '+' : '−') + formatAmount(value);
}
