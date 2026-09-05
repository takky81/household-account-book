import { describe, it, expect } from 'vitest';
import { addMonths, formatDay, formatMonth, monthKeyOf, monthStart, todayIso, weekdayOf } from './date';

describe('対象月', () => {
  it('列8 取引日の年月が対象月になる', () => {
    expect(monthKeyOf('2026-08-31')).toBe('2026-08');
    expect(monthKeyOf('2026-08-01')).toBe('2026-08');
  });

  it('列8 月の境界は Asia/Tokyo で判定する', () => {
    // 2026-08-31 15:00 UTC は東京では 9月1日 0:00
    expect(todayIso(new Date('2026-08-31T15:00:00Z'))).toBe('2026-09-01');
    expect(todayIso(new Date('2026-08-31T14:59:00Z'))).toBe('2026-08-31');
  });

  it('対象月の初日を返す', () => {
    expect(monthStart('2026-08')).toBe('2026-08-01');
  });

  it('前後の月に動かす', () => {
    expect(addMonths('2026-08', -1)).toBe('2026-07');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  it('画面に出す形にする', () => {
    expect(formatMonth('2026-08')).toBe('2026年8月');
  });
});

describe('日付の表示', () => {
  it('曜日を返す', () => {
    expect(weekdayOf('2026-09-06')).toBe('日');
    expect(weekdayOf('2026-09-07')).toBe('月');
    expect(weekdayOf('2026-09-12')).toBe('土');
  });

  it('一覧に出す形にする', () => {
    expect(formatDay('2026-09-06')).toBe('09-06(日)');
  });
});
