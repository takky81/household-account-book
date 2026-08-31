/**
 * テーマの決定と保存。決定表「表示設定と共通の振る舞い」列1・列2 に対応する。
 */

export type Theme = 'light' | 'dark';
export type ThemeSetting = Theme | null;

const STORAGE_KEY = 'household-account-book:theme';

/** 選んだことがなければ OS の設定に従う（列2）。 */
export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): Theme {
  if (setting === 'light' || setting === 'dark') return setting;
  return prefersDark ? 'dark' : 'light';
}

export function nextTheme(current: Theme): Theme {
  return current === 'light' ? 'dark' : 'light';
}

/** 端末に保存した設定を読む。値が壊れていれば選んでいない扱いにする。 */
export function loadTheme(): ThemeSetting {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/** 端末に保存する（列1）。保存できない環境でも動きは変えない。 */
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 保存できなくても表示は切り替える
  }
}
