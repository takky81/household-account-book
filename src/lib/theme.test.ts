import { beforeEach, describe, it, expect } from 'vitest';
import {
  applyTheme,
  loadTheme,
  nextTheme,
  resolveTheme,
  saveTheme,
  type ThemeSetting,
} from './theme';

describe('resolveTheme（決定表「表示設定と共通の振る舞い」列1・列2）', () => {
  it('列2 選んだことがなければ OS の設定に従う', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
  });

  it('列1 選んだことがあればその側にする', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('壊れた値は選んでいない扱いにする', () => {
    expect(resolveTheme('とんでもない値' as ThemeSetting, true)).toBe('dark');
  });

  it('列1 押すたびに反対側へ切り替える', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
  });
});

describe('保存と適用', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('列1 選んだテーマを保存して読み直せる', () => {
    saveTheme('dark');
    expect(loadTheme()).toBe('dark');
  });

  it('列2 OS に合わせるを選ぶと保存を消す', () => {
    saveTheme('dark');
    saveTheme(null);
    expect(loadTheme()).toBeNull();
  });

  it('列1 ダークのときだけ dark クラスを付ける', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
