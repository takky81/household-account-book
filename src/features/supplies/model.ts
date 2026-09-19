/** 不足物資の一覧から、まだ必要な件数を求める。 */
export function missingCount(items: readonly { is_purchased: boolean }[]): number {
  return items.filter((item) => !item.is_purchased).length;
}
