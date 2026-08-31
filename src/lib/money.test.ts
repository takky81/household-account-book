import { describe, it, expect } from 'vitest';
import { formatAmount, formatSigned, parseAmount } from './money';

describe('parseAmount', () => {
  it('列6 桁区切りと通貨記号を落として読む', () => {
    expect(parseAmount('1,001')).toBe(1001);
    expect(parseAmount('¥1,001')).toBe(1001);
    expect(parseAmount(' 780 ')).toBe(780);
  });

  it('列6 0と負の金額は読めない', () => {
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('-100')).toBeNull();
  });

  it('列6 整数でないものは読めない', () => {
    expect(parseAmount('1.5')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('いくらか')).toBeNull();
  });
});

describe('formatAmount', () => {
  it('桁区切りを付ける', () => {
    expect(formatAmount(120000)).toBe('120,000');
  });

  it('収支の向きに応じて符号を付ける', () => {
    expect(formatSigned(4200, 'expense')).toBe('−4,200');
    expect(formatSigned(320000, 'income')).toBe('+320,000');
  });
});
