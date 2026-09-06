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

/**
 * パスワードの最小の長さ（列11）。
 * Supabase 側の下限（`minimum_password_length = 6`）より厳しくして、送る前に弾く。
 */
export const PASSWORD_MIN_LENGTH = 8;

/** 現在のパスワードが違うときの文言（列10）。 */
export const CURRENT_PASSWORD_WRONG = '現在のパスワードが違います';

/** パスワードを変更できなかったときの文言（列10 以外の失敗）。 */
export const PASSWORD_CHANGE_FAILED = 'パスワードを変更できませんでした';

/** 変更できたときの文言（列9）。 */
export const PASSWORD_CHANGED = 'パスワードを変更しました';

/** パスワード変更の入力検査（列11・列12・列13）。整うまで通信しない。 */
export function validatePasswordChange(
  current: string,
  next: string,
  confirm: string,
): Validation {
  if (current === '') {
    return { ok: false, message: '現在のパスワードを入力してください' };
  }
  if (next.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `新しいパスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください` };
  }
  if (next === current) {
    return { ok: false, message: '新しいパスワードが今のものと同じです' };
  }
  if (next !== confirm) {
    return { ok: false, message: '確認用のパスワードが一致しません' };
  }
  return { ok: true };
}
