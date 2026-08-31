import { describe, it, expect } from 'vitest';
import { resolveTheme, nextTheme, type ThemeSetting } from './theme';

describe('resolveTheme（決定表「表示設定と共通の振る舞い」列1・列3）', () => {
  it('列1 選んだことがなければ OS の設定に従う', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
  });

  it('列3 選んだことがあればその側にする', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('壊れた値は選んでいない扱いにする', () => {
    expect(resolveTheme('とんでもない値' as ThemeSetting, true)).toBe('dark');
  });

  it('列2 押すたびに反対側へ切り替える', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
  });
});
