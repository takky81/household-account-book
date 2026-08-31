/**
 * ログインの入力検査（決定表「認証」列2・列3・列4）。
 */

export type Validation = { ok: true } | { ok: false; message: string };

/**
 * ログインに失敗したときの文言。
 * パスワード違い（列2）と未登録メール（列3）で同じものを返す。
 * 違えるとアカウントの有無を判別できてしまう。
 */
export const LOGIN_FAILED = 'メールアドレスまたはパスワードが違います';

/** 書式が整っていなければ送信しない（列4）。 */
export function validateCredentials(email: string, password: string): Validation {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return { ok: false, message: 'メールアドレスの形式が正しくありません' };
  }
  if (password === '') {
    return { ok: false, message: 'パスワードを入力してください' };
  }
  return { ok: true };
}

/** Supabase が返す理由によらず、同じ文言にまとめる（列2・列3）。 */
export function signInErrorMessage(_reason: string): string {
  return LOGIN_FAILED;
}
