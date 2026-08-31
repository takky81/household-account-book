import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrastRatio, readTokens } from './contrast';

/**
 * 決定表「表示設定と共通の振る舞い」列7。
 * 配色は src/index.css の変数だけで決まるので、そこを直接読んで確かめる。
 */
const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
const themes = {
  ライト: readTokens(css, ':root'),
  ダーク: readTokens(css, '.dark'),
};

function color(tokens: Record<string, string>, name: string): string {
  const found = tokens[name];
  if (found === undefined) throw new Error(`--c-${name} が定義されていません`);
  return found;
}

/** 文字と地の組み。4.5:1 以上（WCAG AA の本文）を求める。 */
const TEXT_PAIRS: [string, string][] = [
  ['ink', 'paper'],
  ['ink', 'panel'],
  ['ink', 'subtle'],
  ['ink', 'hover'],
  ['ink-soft', 'panel'],
  ['ink-soft', 'subtle'],
  ['muted', 'panel'],
  ['muted', 'paper'],
  ['link', 'paper'],
  ['link', 'panel'],
  ['warn', 'panel'],
  ['warn', 'warn-panel'],
  ['income', 'panel'],
  ['income', 'subtle'],
  ['expense', 'panel'],
  ['expense', 'subtle'],
  ['shared', 'shared-panel'],
  ['own', 'own-panel'],
];

/** 線と地の組み。3:1 以上（WCAG AA の図形）を求める。 */
const EDGE_PAIRS: [string, string][] = [
  ['edge', 'panel'],
  ['edge', 'paper'],
  ['bar', 'bar-track'],
];

describe.each(Object.entries(themes))('%s', (_name, tokens) => {
  it.each(TEXT_PAIRS)('列7 --c-%s は --c-%s の上で 4.5:1 以上', (fg, bg) => {
    expect(contrastRatio(color(tokens, fg), color(tokens, bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(EDGE_PAIRS)('列7 --c-%s は --c-%s の上で 3:1 以上', (fg, bg) => {
    expect(contrastRatio(color(tokens, fg), color(tokens, bg))).toBeGreaterThanOrEqual(3);
  });

  it('列7 主ボタンは地が ink・文字が paper', () => {
    expect(contrastRatio(color(tokens, 'paper'), color(tokens, 'ink'))).toBeGreaterThanOrEqual(4.5);
  });
});
