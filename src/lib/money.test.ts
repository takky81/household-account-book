import { describe, it, expect } from 'vitest';
import {
  evaluateExpression,
  formatAmount,
  formatSigned,
  isAmountExpression,
  parseAmount,
  parseAmountInput,
} from './money';

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

describe('isAmountExpression', () => {
  it('演算子や括弧を含むものだけを式とみなす', () => {
    expect(isAmountExpression('1200')).toBe(false);
    expect(isAmountExpression('1,200')).toBe(false);
    expect(isAmountExpression('1200+800')).toBe(true);
    expect(isAmountExpression('1200＋800')).toBe(true);
    expect(isAmountExpression('(1200)')).toBe(true);
  });
});

describe('evaluateExpression', () => {
  it('列16 四則演算を計算する', () => {
    expect(evaluateExpression('1200+800')).toBe(2000);
    expect(evaluateExpression('3000-500')).toBe(2500);
    expect(evaluateExpression('380*3')).toBe(1140);
    expect(evaluateExpression('3000/2')).toBe(1500);
  });

  it('列16 掛け算と割り算を先に計算し、括弧が優先する', () => {
    expect(evaluateExpression('100+200*3')).toBe(700);
    expect(evaluateExpression('(100+200)*3')).toBe(900);
  });

  it('列16 全角の演算子・数字・桁区切りを受け取る', () => {
    expect(evaluateExpression('１２００＋８００')).toBe(2000);
    expect(evaluateExpression('1,200 × 2')).toBe(2400);
    expect(evaluateExpression('3000円÷2')).toBe(1500);
  });

  it('列16 符号は数の前に付けられる', () => {
    expect(evaluateExpression('1200+-800')).toBe(400);
    expect(evaluateExpression('-500+800')).toBe(300);
  });

  it('列16 途中の小数を許す（税込の計算）', () => {
    expect(evaluateExpression('1000*1.08')).toBeCloseTo(1080);
  });

  it('列17 式になっていないものは読めない', () => {
    expect(evaluateExpression('1200+')).toBeNull();
    expect(evaluateExpression('(1200')).toBeNull();
    expect(evaluateExpression('1200/0')).toBeNull();
    expect(evaluateExpression('いくらか+1')).toBeNull();
    expect(evaluateExpression('')).toBeNull();
  });
});

describe('parseAmountInput', () => {
  it('列16 式は計算して四捨五入する', () => {
    expect(parseAmountInput('1200+800')).toBe(2000);
    expect(parseAmountInput('1000/3')).toBe(333);
    expect(parseAmountInput('1000*1.085')).toBe(1085);
  });

  it('列16 式でなければ parseAmount と同じ', () => {
    expect(parseAmountInput('1,001')).toBe(1001);
    expect(parseAmountInput('1.5')).toBeNull();
    expect(parseAmountInput('いくらか')).toBeNull();
  });

  it('列17 計算結果が0以下になる式は読めない', () => {
    expect(parseAmountInput('500-500')).toBeNull();
    expect(parseAmountInput('500-800')).toBeNull();
  });
});
