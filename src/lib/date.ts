/**
 * 対象月まわり（docs/仕様書.md §5.3）。決定表「集計」列8 に対応する。
 * 月の境界は Asia/Tokyo で判定する。締め日の概念は持たない。
 */

const TZ = 'Asia/Tokyo';

/** その時刻を Asia/Tokyo で見たときの日付（YYYY-MM-DD）。 */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** 取引日の年月（YYYY-MM）。 */
export function monthKeyOf(dateIso: string): string {
  return dateIso.slice(0, 7);
}

/** 対象月の初日（YYYY-MM-01）。予算の month 列はこの形で持つ。 */
export function monthStart(monthKey: string): string {
  return `${monthKey}-01`;
}

/** 対象月の末日（YYYY-MM-DD）。範囲で絞るときに使う。 */
export function monthEnd(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${monthKey}-${String(last).padStart(2, '0')}`;
}

/** 対象月を前後に動かす。 */
export function addMonths(monthKey: string, diff: number): string {
  const [y, m] = monthKey.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + diff;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** 画面に出す形。 */
export function formatMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-') as [string, string];
  return `${Number(y)}年${Number(m)}月`;
}

/** 今日が属する対象月。 */
export function currentMonthKey(now: Date = new Date()): string {
  return monthKeyOf(todayIso(now));
}
