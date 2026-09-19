/**
 * 表示順に現れる日付のまとまりへ交互の色を割り当てる。
 * 日付の間隔は見ず、同じ日付が続く間だけ同じまとまりとして扱う。
 */
export function stripeDateGroups<T extends { occurred_on: string }>(rows: readonly T[]) {
  let previousDate: string | null = null;
  let tinted = false;

  return rows.map((row) => {
    if (row.occurred_on !== previousDate) {
      tinted = !tinted;
      previousDate = row.occurred_on;
    }
    return { row, tinted };
  });
}
