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

/**
 * 全角と桁区切り・通貨記号を落として、式として読める形にする。
 * ＋－×÷（）と全角数字はそのままでは計算できないので、ここで ASCII に寄せる。
 */
function normalizeExpression(input: string): string {
  return input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/＋/g, '+')
    .replace(/[－ー−―‐]/g, '-')
    .replace(/[×＊]/g, '*')
    .replace(/[÷／]/g, '/')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/．/g, '.')
    .replace(/[,\s¥￥円]/g, '');
}

/** 演算子か括弧を含むか。含まなければただの数として読む。 */
export function isAmountExpression(input: string): boolean {
  return /[+\-*/()]/.test(normalizeExpression(input));
}

/**
 * 四則演算の式を計算する。読めなければ null。
 * eval は使わず、+ - * / と括弧・単項マイナスだけを自前で解く。
 * 途中の小数は許す（1000*1.08 のような税込計算のため）。丸めは呼ぶ側で行う。
 */
export function evaluateExpression(input: string): number | null {
  const text = normalizeExpression(input);
  let pos = 0;

  const peek = () => text[pos];

  function factor(): number | null {
    if (peek() === '-') {
      pos += 1;
      const value = factor();
      return value === null ? null : -value;
    }
    if (peek() === '+') {
      pos += 1;
      return factor();
    }
    if (peek() === '(') {
      pos += 1;
      const value = expression();
      if (value === null || peek() !== ')') return null;
      pos += 1;
      return value;
    }
    const digits = /^\d+(\.\d+)?/.exec(text.slice(pos));
    if (digits === null) return null;
    pos += digits[0].length;
    return Number(digits[0]);
  }

  function term(): number | null {
    let left = factor();
    if (left === null) return null;
    while (peek() === '*' || peek() === '/') {
      const op = text[pos];
      pos += 1;
      const right = factor();
      if (right === null) return null;
      if (op === '/' && right === 0) return null; // 0除算は「読めない」と同じ扱い
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }

  function expression(): number | null {
    let left = term();
    if (left === null) return null;
    while (peek() === '+' || peek() === '-') {
      const op = text[pos];
      pos += 1;
      const right = term();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  const value = expression();
  // 式の途中で止まっていたら（"1+" や "1)2" など）読めなかったことにする
  if (value === null || pos !== text.length || !Number.isFinite(value)) return null;
  return value;
}

/**
 * 金額欄の入力を読む。式なら計算して四捨五入する（金額は整数。§3）。
 * 式でなければ parseAmount と同じで、"1.5" のような小数はそのまま読めない。
 */
export function parseAmountInput(input: string): number | null {
  if (!isAmountExpression(input)) return parseAmount(input);
  const value = evaluateExpression(input);
  if (value === null) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}
